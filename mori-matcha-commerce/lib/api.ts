// Use a same-origin proxy when pointing this client at a replacement backend.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || '/api/v1';

type ApiResponse<T> = {
  success: boolean;
  data: T;
  error?: { message?: string };
};

export async function api<T = unknown>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await fetch(API_BASE + path, {
    method,
    credentials: 'include',
    headers: data instanceof FormData || data === undefined ? {} : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : data instanceof FormData ? data : JSON.stringify(data),
  });
  let result: ApiResponse<T>;
  try {
    result = await response.json();
  } catch {
    throw new Error('服务返回格式异常，请稍后重试');
  }
  if (!response.ok || !result?.success) {
    throw Object.assign(new Error(result?.error?.message || '请求失败'), { status: response.status });
  }
  return result.data;
}
