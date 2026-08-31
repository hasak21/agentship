import { createServer } from "node:http";
import next from "next";

const port = parseInt(process.env.PORT || "3000", 10);
const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    const server = createServer((req, res) => {
      handle(req, res);
    });

    server.listen(port, hostname, () => {
      console.log(`> ✦ AgentShip Mission Control running at http://${hostname}:${port}`);
      console.log(`> ✦ Windows Host / Local URL: http://localhost:${port}`);
      console.log(`> 🔌 MCP Server Endpoint ready at http://localhost:${port}/api/mcp`);
    });
  })
  .catch((err) => {
    console.error("Fatal error during server startup:", err);
    process.exit(1);
  });
