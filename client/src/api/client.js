async function request(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const body = await response.json();
      if (body.error) message = body.error;
    } catch {
      // ignore parse failure, keep default message
    }
    throw new Error(message);
  }
  if (response.status === 204) return null;
  return response.json();
}

export function get(path) {
  return request(path);
}

export function post(path, body) {
  return request(path, { method: 'POST', body: JSON.stringify(body) });
}

export function put(path, body) {
  return request(path, { method: 'PUT', body: JSON.stringify(body) });
}

export function patch(path, body) {
  return request(path, { method: 'PATCH', body: JSON.stringify(body) });
}

export function del(path) {
  return request(path, { method: 'DELETE' });
}
