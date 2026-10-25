import { MCPServerFactory, ExecutionRouter, TransportManager } from 'apcore-mcp';
import { ap } from './demo-display.mjs';

// Isolate adapter registration from serve()'s own upstream startup logger.
await ap.init();
const factory = new MCPServerFactory();
const server = factory.createServer('display-fixture', '1.0.0');
const tools = factory.buildTools(ap.registry.raw);
factory.registerHandlers(server, tools, new ExecutionRouter(ap.executor.raw));
await new TransportManager().runStdio(server);
