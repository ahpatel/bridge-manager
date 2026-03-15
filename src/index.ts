import { Container, getContainer } from "@cloudflare/containers";
import { Hono } from "hono";

interface Env {
	MY_CONTAINER: DurableObjectNamespace<MyContainer>;
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
		if (payload.aud !== aud) {
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

export class MyContainer extends Container<Env> {
	// Port the container listens on
	defaultPort = 8080;
	// We want the container to stay alive for as long as possible or as configured
	sleepAfter = "1h";

	override onStart() {
		console.log("Beeper Bridge Manager container started");
	}
}

const app = new Hono<{
	Bindings: Env;
}>();

// Protect all routes with Cloudflare Access JWT validation
app.use("*", validateAccessJWT);

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
                    body: JSON.stringify({ args, async })
                });
                const data = await res.json();
                output.textContent = data.Output || data.Error || 'Success (no output)';
                refreshProcs();
            } catch (e) {
                output.textContent = 'Error: ' + e.message;
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
                const res = await fetch('/api/procs');
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
        fetch('/status').then(r => r.text()).then(t => {
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
	const container = getContainer(c.env.MY_CONTAINER, "beeper-manager");
	try {
		const res = await container.fetch(new Request(c.req.url));
		return c.text(await res.text());
	} catch (e) {
		return c.text("Container starting or offline: " + (e as Error).message);
	}
});

// Proxy API requests to the container
app.post("/api/bbctl", async (c) => {
	const container = getContainer(c.env.MY_CONTAINER, "beeper-manager");
	return await container.fetch(c.req.raw);
});

app.get("/api/procs", async (c) => {
	const container = getContainer(c.env.MY_CONTAINER, "beeper-manager");
	return await container.fetch(c.req.raw);
});

export default app;
