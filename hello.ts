export default async function hello(): Promise<Response> {
  return Response.json({ service: "placement-dashboard", status: "ok" });
}
