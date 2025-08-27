import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  const { message } = await req.json().catch(() => ({ message: "" }));
  return new Response(JSON.stringify({ reply: `Echo: ${message}` }), {
    headers: { "content-type": "application/json" },
  });
}
