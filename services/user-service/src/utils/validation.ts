/**
 * Validation utilities for international formats
 */

const ISO_639_1_CODES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'ja', 'ko', 'ar', 'hi'];
const ISO_4217_CODES = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'INR', 'CAD', 'AUD', 'CHF', 'MXN'];

/**
 * Validate and normalize phone number
 * Simple validation - you can enhance with libphonenumber-js later
 */
export function validatePhoneNumber(phone: string): boolean {
  // Remove spaces, dashes, parentheses
  const cleaned = phone.replace(/[\s\-()]/g, '');
  // Check if it's 10-15 digits, optionally starting with +
  return /^\+?\d{10,15}$/.test(cleaned);
}

export function normalizePhoneNumber(phone: string): string {
  return phone.replace(/[\s\-()]/g, '');
}

/**
 * Validate postal code (basic validation)
 * For production, use country-specific validation
 */
export function validatePostalCode(postalCode: string, country: string): boolean {
  const cleaned = postalCode.trim().toUpperCase();

  // US ZIP code: 12345 or 12345-6789
  if (country === 'US' || country === 'USA') {
    return /^\d{5}(-\d{4})?$/.test(cleaned);
  }

  // Canadian postal code: A1A 1A1
  if (country === 'CA' || country === 'Canada') {
    return /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/.test(cleaned);
  }

  // UK postcode: SW1A 1AA
  if (country === 'GB' || country === 'UK') {
    return /^[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}$/.test(cleaned);
  }

  // Generic: 3-10 alphanumeric characters
  return /^[A-Z0-9]{3,10}$/.test(cleaned);
}

/**
 * Validate ISO 639-1 language code
 */
export function validateLanguageCode(lang: string): boolean {
  return ISO_639_1_CODES.includes(lang.toLowerCase());
}

/**
 * Validate ISO 4217 currency code
 */
export function validateCurrencyCode(currency: string): boolean {
  return ISO_4217_CODES.includes(currency.toUpperCase());
}

/**
 * Validate timezone (IANA timezone database)
 * This is a simplified check - for production, use Intl.supportedValuesOf('timeZone')
 */
export function validateTimezone(tz: string): boolean {
  try {
    // Try to format a date with this timezone
    Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate address type (shipping or billing)
 */
export function validateAddressType(type: string): boolean {
  return ['shipping', 'billing'].includes(type.toLowerCase());
}
