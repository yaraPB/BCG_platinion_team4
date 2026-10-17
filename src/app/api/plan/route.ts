import { calculatePlan, parsePlanInput, PlanInputError } from "@/lib/server/planning";

const headers = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 4096;

export function GET() {
  return Response.json(calculatePlan(), { headers });
}

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return Response.json({ error: "Use Content-Type: application/json." }, { status: 415, headers });
  }
  // Read a bounded stream rather than trusting Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "A JSON request body is required." }, { status: 400, headers });
  try {
    const decoder = new TextDecoder();
    let text = "";
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return Response.json({ error: "Request body exceeds 4096 bytes." }, { status: 413, headers });
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const closed = parsePlanInput(JSON.parse(text));
    return Response.json(calculatePlan(closed), { headers });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof PlanInputError) {
      return Response.json({ error: error instanceof SyntaxError ? "Request body must contain valid JSON." : error.message }, { status: 400, headers });
    }
    return Response.json({ error: "Unable to calculate the plan. Please try again." }, { status: 500, headers });
  } finally {
    reader.releaseLock();
  }
}
