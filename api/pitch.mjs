import { generatePitchWithProvider } from "../src/llm/serverProvider.mjs";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const payload = await readBody(request);
    const result = await generatePitchWithProvider(payload);
    response.status(200).json(result);
  } catch {
    response.status(400).json({ error: "Invalid pitch request" });
  }
}

async function readBody(request) {
  if (request.body && typeof request.body === "object") {
    return request.body;
  }

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}
