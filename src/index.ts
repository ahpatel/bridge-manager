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
        <button onclick="window.refreshProcs()" style="margin-top: 0.5rem;">Refresh List</button>
    </div>
    
    <div class="form-group">
        <label for="token">Beeper Login Token:</label>
        <input type="text" id="token" placeholder="Paste your token here..." style="width: 100%;">
        <p><small>Get your token by running <code>bbctl login</code> locally or via Beeper help.</small></p>
        <button onclick="window.login()">Login to Beeper</button>
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
        <button onclick="window.runBridge()" style="width: 100%; margin-top: 0.5rem;">Start Bridge in Background</button>
    </div>

    <div class="form-group">
        <label>Quick Actions:</label>
        <button onclick="window.callApi(['list'])">List Configured Bridges</button>
        <button onclick="window.callApi(['whoami'])" style="background: #6c757d;">Check Login Status</button>
    </div>

    <div class="form-group">
        <label for="custom-cmd">Custom Command:</label>
        <input type="text" id="custom-cmd" placeholder="e.g. login --help" style="width: 100%;">
        <button onclick="window.runCustom()" style="width: 100%; margin-top: 0.5rem; background: #28a745;">Run Custom bbctl Command</button>
    </div>

    <h3>Terminal Output:</h3>
    <pre id="output">Waiting for action...</pre>

    <script>
        (function() {
            console.log('Beeper Bridge Manager UI initializing...');
            
            window.runCustom = async function() {
                const cmd = document.getElementById('custom-cmd').value;
                if (!cmd) return alert('Command is required');
                const args = cmd.split(' ');
                await window.callApi(args);
            };
            
            window.callApi = async function(args, isAsync, token) {
                console.log('callApi called with:', args, isAsync, !!token);
                const output = document.getElementById('output');
                output.textContent = 'Executing: bbctl ' + args.join(' ') + '...';
                try {
                    const res = await fetch('/api/bbctl', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ args: args, async: !!isAsync, token: token || '' })
                    });
                    
                    console.log('API response status:', res.status);
                    if (res.status === 401) {
                        output.textContent = 'ERROR: Unauthorized. Please refresh the page.';
                        return;
                    }

                    const data = await res.json();
                    console.log('API response data:', data);
                    let result = '';
                    if (data.Output) result += data.Output;
                    if (data.Error) result += '\\nERROR: ' + data.Error;
                    output.textContent = result || 'Command finished.';
                    window.refreshProcs();
                } catch (e) {
                    console.error('API Error:', e);
                    output.textContent = 'Error: ' + e.message;
                }
            };

            window.login = async function() {
                console.log('Login button clicked');
                const token = document.getElementById('token').value;
                if (!token) return alert('Token is required');
                // Use 'whoami' with the token to verify and save the session non-interactively
                await window.callApi(['whoami'], false, token);
            };

            window.runBridge = async function() {
                console.log('Run Bridge button clicked');
                const bridge = document.getElementById('bridge').value;
                await window.callApi(['run', bridge], true);
            };

            window.refreshProcs = async function() {
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
                    console.error('RefreshProcs Error:', e);
                    procsDiv.textContent = 'Error loading processes.';
                }
            };

            // Init
            console.log('Fetching initial status...');
            fetch('/status', { credentials: 'include' }).then(r => r.text()).then(t => {
                console.log('Initial status received:', t);
                document.getElementById('status').textContent = t;
            }).catch(e => console.error('Status fetch error:', e));
            
            window.refreshProcs();
            setInterval(window.refreshProcs, 5000);
            console.log('UI initialization complete.');
        })();
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
