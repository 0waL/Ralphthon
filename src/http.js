export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function badRequest(message, extra) {
  return new HttpError(400, message, extra);
}

export function notFound(message = '찾을 수 없습니다.') {
  return new HttpError(404, message);
}

export function forbidden(message = '권한이 없습니다.') {
  return new HttpError(403, message);
}

export function parseId(value) {
  const id = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(id) || id <= 0 || String(id) !== String(value)) throw notFound();
  return id;
}

export function requiredString(body, field, label, { max = 200 } = {}) {
  const value = typeof body?.[field] === 'string' ? body[field].trim() : '';
  if (!value) throw badRequest(`${label}을(를) 입력하세요.`);
  if (value.length > max) throw badRequest(`${label}은(는) ${max}자 이하로 입력하세요.`);
  return value;
}

export function optionalString(body, field, { max = 200 } = {}) {
  const value = typeof body?.[field] === 'string' ? body[field].trim() : '';
  return value.slice(0, max);
}
