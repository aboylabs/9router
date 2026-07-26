export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers
    },
    credentials: "include"
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text || `Request failed: ${response.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      if (parsed.error || parsed.message) message = parsed.error || parsed.message || message;
    } catch {
      // keep raw text
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}
