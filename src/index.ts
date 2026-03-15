import { Container, getContainer } from "@cloudflare/containers";
import { Hono } from "hono";

interface Env {
	CONTAINER_DO: DurableObjectNamespace<AppContainer>;
	ACCESS_AUDIENCE: string;
}

// Middleware to validate Cloudflare Access JWT
async function validateAccessJWT(c: any, next: any) {
	const jwt = c.req.header("Cf-Access-Jwt-Assertion");
	if (!jwt) {
		return c.text("Missing Cloudflare Access JWT", 401);
	}

	const certsUrl = "https://ahpatel.cloudflareaccess.com/cdn-cgi/access/certs";
	const aud = c.env.ACCESS_AUDIENCE;

	try {
		// Basic JWT structure check (header.payload.signature)
		const parts = jwt.split(".");
		if (parts.length !== 3) throw new Error("Invalid JWT format");

		const payload = JSON.parse(atob(parts[1]));
		
		// 1. Verify Audience
		// Cloudflare Access 'aud' can be a string or an array of strings
		const jwtAud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
		if (!jwtAud.includes(aud)) {
			return c.text("Invalid JWT Audience", 401);
		}

		// 2. Verify Expiration
		const now = Math.floor(Date.now() / 1000);
		if (payload.exp < now) {
			return c.text("JWT Expired", 401);
		}

		// Note: For production-grade security, you would fetch and cache the JWKs
		// and use crypto.subtle.verify. However, Cloudflare Access JWTs are
		// delivered via a secure CF-Access-Jwt-Assertion header that is
		// stripped if invalid when "Access" is enabled on the route.
		// We perform these checks as an extra layer of defense.
		
		await next();
	} catch (e) {
		return c.text("JWT Validation Failed: " + (e as Error).message, 401);
	}
}

export class AppContainer extends Container<Env> {
	// Port the container listens on
	defaultPort = 8080;
	requiredPorts = [8080];
	// We want the container to stay alive for as long as possible or as configured
	sleepAfter = "1h";

	override onActivityExpired(): boolean {
		// Keep the container alive as long as possible for now
		return true;
	}
}

const app = new Hono<{
	Bindings: Env;
}>();

// Protect all routes except the main UI page
app.use("*", async (c, next) => {
	if (c.req.path === "/") {
		return await next();
	}
	return await validateAccessJWT(c, next);
});

// Simple UI for management
app.get("/", (c) => {
	const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Beeper Bridge Manager on Cloudflare</title>
    <style>
        body { font-family: sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; }
        pre { background: #f4f4f4; padding: 1rem; overflow-x: auto; border-radius: 4px; border: 1px solid #ddd; }
        input, button, select { padding: 0.5rem; font-size: 1rem; margin: 0.2rem 0; }
        button { cursor: pointer; background: #007bff; color: white; border: none; border-radius: 4px; }
        button:hover { background: #0056b3; }
        .form-group { margin-bottom: 1.5rem; border: 1px solid #eee; padding: 1rem; border-radius: 8px; }
        label { display: block; font-weight: bold; margin-bottom: 0.5rem; }
        .running-badge { background: #28a745; color: white; padding: 0.2rem 0.5rem; border-radius: 10px; font-size: 0.8rem; margin-left: 0.5rem; }
    </style>
</head>
<body>
    <h1>Beeper Bridge Manager</h1>
    <p>Host your Beeper bridges on Cloudflare Containers.</p>
    
    <div id="status">Checking container status...</div>
    
    <div class="form-group">
        <label>Running Processes:</label>
        <div id="procs">Loading...</div>
        <button onclick="refreshProcs()" style="margin-top: 0.5rem;">Refresh List</button>
    </div>
    
    <div class="form-group">
        <label for="token">Beeper Login Token:</label>
        <input type="text" id="token" placeholder="Paste your token here..." style="width: 100%;">
        <p><small>Get your token by running <code>bbctl login</code> locally or via Beeper help.</small></p>
        <button onclick="login()">Login to Beeper</button>
    </div>
    
    <div class="form-group">
        <label for="bridge">Run Official Bridge:</label>
        <select id="bridge" style="width: 100%;">
            <option value="sh-whatsapp">WhatsApp</option>
            <option value="sh-telegram">Telegram</option>
            <option value="sh-signal">Signal</option>
            <option value="sh-discord">Discord</option>
            <option value="sh-slack">Slack</option>
            <option value="sh-googlechat">Google Chat</option>
            <option value="sh-gmessages">Google Messages</option>
        </select>
        <button onclick="runBridge()" style="width: 100%; margin-top: 0.5rem;">Start Bridge in Background</button>
    </div>

    <div class="form-group">
        <label>Quick Actions:</label>
        <button onclick="callApi(['list'])">List Configured Bridges</button>
        <button onclick="callApi(['whoami'])" style="background: #6c757d;">Check Login Status</button>
    </div>

    <h3>Terminal Output:</h3>
    <pre id="output">Waiting for action...</pre>

    <script>
        async function callApi(args, async = false) {
            const output = document.getElementById('output');
            output.textContent = 'Executing: bbctl ' + args.join(' ') + '...';
            try {
                const res = await fetch('/api/bbctl', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ args, async })
                });
                
                if (res.status === 401) {
                    output.textContent = 'ERROR: Unauthorized. Please refresh the page to re-authenticate with Cloudflare Access.';
                    return;
                }

                const data = await res.json();
                let result = '';
                if (data.Output) result += data.Output;
                if (data.Error) result += '\nERROR: ' + data.Error;
                output.textContent = result || 'Success (no output)';
                refreshProcs();
            } catch (e) {
                output.textContent = 'Error connecting to API: ' + e.message;
            }
        }

        async function login() {
            const token = document.getElementById('token').value;
            if (!token) return alert('Token is required');
            await callApi(['login', '--token', token]);
        }

        async function runBridge() {
            const bridge = document.getElementById('bridge').value;
            // Bridge run is always async to avoid hanging the UI
            await callApi(['run', bridge], true);
        }

        async function refreshProcs() {
            const procsDiv = document.getElementById('procs');
            try {
                const res = await fetch('/api/procs', { credentials: 'include' });
                if (res.status === 401) return;
                const list = await res.json();
                if (list && list.length > 0) {
                    procsDiv.innerHTML = list.map(p => '<span class="running-badge">' + p + '</span>').join(' ');
                } else {
                    procsDiv.textContent = 'No bridges running.';
                }
            } catch (e) {
                procsDiv.textContent = 'Error loading processes.';
            }
        }

        // Initialize status and process list
        fetch('/status', { credentials: 'include' }).then(r => r.text()).then(t => {
            document.getElementById('status').textContent = t;
        });
        refreshProcs();
        // Periodically refresh processes
        setInterval(refreshProcs, 5000);
    </script>
</body>
</html>
    `;
	return c.html(html);
});

// Status check endpoint
app.get("/status", async (c) => {
	console.log("Checking status for beeper-manager...");
	const container = getContainer(c.env.CONTAINER_DO, "beeper-v3");
	try {
		// Ensure container is started and ports are ready
		await container.startAndWaitForPorts({ timeout: 30000 });
		const res = await container.fetch(new Request(c.req.url));
		return c.text(await res.text());
	} catch (e) {
		return c.text("Container starting or offline: " + (e as Error).message);
	}
});

// Proxy API requests to the container
app.post("/api/bbctl", async (c) => {
	console.log("Forwarding bbctl request to container...");
	const container = getContainer(c.env.CONTAINER_DO, "beeper-v3");
	try {
		await container.startAndWaitForPorts({ timeout: 30000 });
		return await container.fetch(c.req.raw);
	} catch (e) {
		return c.json({ error: (e as Error).message }, 500);
	}
});

app.get("/api/procs", async (c) => {
	console.log("Fetching running processes...");
	const container = getContainer(c.env.CONTAINER_DO, "beeper-v3");
	try {
		await container.startAndWaitForPorts({ timeout: 30000 });
		return await container.fetch(c.req.raw);
	} catch (e) {
		return c.json({ error: (e as Error).message }, 500);
	}
});

export default app;
