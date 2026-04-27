export class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.status = 400;
  }
}

export const required = (value, field) => {
  if (value === undefined || value === null || value === '') {
    throw new ValidationError(`Field '${field}' wajib diisi`, field);
  }
  return value;
};

export const validNumber = (value, field, { min, max, integer = false } = {}) => {
  const num = Number(value);
  if (isNaN(num)) {
    throw new ValidationError(`Field '${field}' harus angka`, field);
  }
  if (integer && !Number.isInteger(num)) {
    throw new ValidationError(`Field '${field}' harus integer`, field);
  }
  if (min !== undefined && num < min) {
    throw new ValidationError(`Field '${field}' minimal ${min}`, field);
  }
  if (max !== undefined && num > max) {
    throw new ValidationError(`Field '${field}' maksimal ${max}`, field);
  }
  return num;
};

export const validString = (value, field, { min = 1, max = 255 } = {}) => {
  if (typeof value !== 'string') {
    throw new ValidationError(`Field '${field}' harus string`, field);
  }
  const trimmed = value.trim();
  if (trimmed.length < min) {
    throw new ValidationError(`Field '${field}' minimal ${min} karakter`, field);
  }
  if (trimmed.length > max) {
    throw new ValidationError(`Field '${field}' maksimal ${max} karakter`, field);
  }
  return trimmed;
};

export const validEnum = (value, field, allowed) => {
  if (!allowed.includes(value)) {
    throw new ValidationError(
      `Field '${field}' harus salah satu dari: ${allowed.join(', ')}`,
      field
    );
  }
  return value;
};

export const validUUID = (value, field) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(value)) {
    throw new ValidationError(`Field '${field}' bukan UUID valid`, field);
  }
  return value;
};

