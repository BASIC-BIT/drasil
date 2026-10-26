import { handleMcpRequest } from '@/lib/mcp/endpoint';
export const runtime = 'nodejs';
export const GET = handleMcpRequest;
export const POST = handleMcpRequest;
export const DELETE = handleMcpRequest;
