import { network } from "@/lib/data/network";

export function GET() {
  return Response.json(network);
}
