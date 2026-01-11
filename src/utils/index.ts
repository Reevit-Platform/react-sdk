/**
 * Utility functions for the Reevit React SDK
 */

import airteltigoLogo from '../assets/methods/airteltigo.png';
import applePayLogo from '../assets/methods/apple-pay.png';
import googlePayLogo from '../assets/methods/google-pay.png';
import mastercardLogo from '../assets/methods/mastercard.png';
import mpesaLogo from '../assets/methods/mpesa.png';
import mtnLogo from '../assets/methods/mtn.png';
import telecelLogo from '../assets/methods/telecel.png';
import visaLogo from '../assets/methods/visa.png';

export type AssetSource = string | { src: string };

export function resolveAssetSrc(asset?: AssetSource | null): string | undefined {
  if (!asset) return undefined;
  if (typeof asset === 'string') return asset;
  if (typeof asset === 'object' && 'src' in asset && typeof asset.src === 'string') {
    return asset.src;
  }
  return undefined;
}

/**
 * Format amount for display
 */
export function formatAmount(amount: number, currency: string): string {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
  });

  // Amount is in smallest unit (pesewas, kobo, cents)
  return formatter.format(amount / 100);
}

/**
 * Generate a unique reference if not provided
 */
export function generateReference(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `reevit_${timestamp}_${random}`;
}

/**
 * Validate phone number for mobile money
 */
export function validatePhone(phone: string, network?: string): boolean {
  // Remove spaces and dashes
  const cleaned = phone.replace(/[\s-]/g, '');

  // Check for valid Ghana phone number formats
  const patterns = {
    mtn: /^(0|233|\+233)?(24|54|55|59)\d{7}$/,
    telecel: /^(0|233|\+233)?(20|50)\d{7}$/,
    airteltigo: /^(0|233|\+233)?(26|27|56|57)\d{7}$/,
  };

  if (network && patterns[network as keyof typeof patterns]) {
    return patterns[network as keyof typeof patterns].test(cleaned);
  }

  // If no network specified, check all patterns
  return Object.values(patterns).some((pattern) => pattern.test(cleaned));
}

/**
 * Format phone number for display
 */
export function formatPhone(phone: string): string {
  const cleaned = phone.replace(/[\s-]/g, '');

  // Format as 0XX XXX XXXX
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    return `${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6)}`;
  }

  // Format +233 XX XXX XXXX
  if (cleaned.startsWith('+233') && cleaned.length === 13) {
    return `${cleaned.slice(0, 4)} ${cleaned.slice(4, 6)} ${cleaned.slice(6, 9)} ${cleaned.slice(9)}`;
  }

  return phone;
}

/**
 * Detect mobile money network from phone number
 */
export function detectNetwork(phone: string): string | null {
  const cleaned = phone.replace(/[\s-]/g, '');

  const prefixes: Record<string, string[]> = {
    mtn: ['024', '054', '055', '059', '23324', '23354', '23355', '23359'],
    telecel: ['020', '050', '23320', '23350'],
    airteltigo: ['026', '027', '056', '057', '23326', '23327', '23356', '23357'],
  };

  for (const [network, networkPrefixes] of Object.entries(prefixes)) {
    for (const prefix of networkPrefixes) {
      if (cleaned.startsWith(prefix) || cleaned.startsWith('0' + prefix.slice(3))) {
        return network;
      }
    }
  }

  return null;
}

/**
 * Create CSS variables from theme
 */
export function createThemeVariables(theme: Record<string, string | undefined>): Record<string, string> {
  const variables: Record<string, string> = {};

  if (theme.primaryColor) {
    variables['--reevit-primary'] = theme.primaryColor;
    if (theme.primaryForegroundColor) {
      variables['--reevit-primary-foreground'] = theme.primaryForegroundColor;
    } else {
      const contrast = getContrastingColor(theme.primaryColor);
      if (contrast) {
        variables['--reevit-primary-foreground'] = contrast;
      }
    }
  }
  if (theme.backgroundColor) {
    variables['--reevit-background'] = theme.backgroundColor;
  }
  if (theme.surfaceColor) {
    variables['--reevit-surface'] = theme.surfaceColor;
  }
  if (theme.textColor) {
    variables['--reevit-text'] = theme.textColor;
  }
  if (theme.mutedTextColor) {
    variables['--reevit-text-secondary'] = theme.mutedTextColor;
  }
  if (theme.borderRadius) {
    variables['--reevit-radius'] = theme.borderRadius;
    variables['--reevit-radius-sm'] = theme.borderRadius;
    variables['--reevit-radius-lg'] = theme.borderRadius;
  }
  if (theme.fontFamily) {
    variables['--reevit-font'] = theme.fontFamily;
  }

  return variables;
}

function getContrastingColor(color: string): string | null {
  const hex = color.trim();
  if (!hex.startsWith('#')) {
    return null;
  }

  const normalized = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;

  if (normalized.length !== 7) {
    return null;
  }

  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);

  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return null;
  }

  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness >= 140 ? '#0b1120' : '#ffffff';
}

/**
 * Merge class names
 */
export function cn(...classes: (string | undefined | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

/**
 * Get default brand colors for a PSP
 */
export function getPspBrandColors(provider: string): { backgroundColor: string; primaryColor: string; primaryForegroundColor: string } {
  const p = provider.toLowerCase();

  const brandColors: Record<string, { backgroundColor: string; primaryColor: string; primaryForegroundColor: string }> = {
    paystack: {
      backgroundColor: '#E8F5F0',
      primaryColor: '#00C3A0',
      primaryForegroundColor: '#FFFFFF',
    },
    hubtel: {
      backgroundColor: '#E8F5EC',
      primaryColor: '#00A651',
      primaryForegroundColor: '#FFFFFF',
    },
    flutterwave: {
      backgroundColor: '#FFF5E6',
      primaryColor: '#F5A623',
      primaryForegroundColor: '#000000',
    },
    stripe: {
      backgroundColor: '#EEF0FF',
      primaryColor: '#635BFF',
      primaryForegroundColor: '#FFFFFF',
    },
    monnify: {
      backgroundColor: '#FFF0E6',
      primaryColor: '#FF6B00',
      primaryForegroundColor: '#FFFFFF',
    },
    mpesa: {
      backgroundColor: '#E8F5E9',
      primaryColor: '#4CAF50',
      primaryForegroundColor: '#FFFFFF',
    },
  };

  return brandColors[p] || {
    backgroundColor: '#F5F5F5',
    primaryColor: '#333333',
    primaryForegroundColor: '#FFFFFF',
  };
}

/**
 * Get country code from currency
 */
export function getCountryFromCurrency(currency: string): string {
  const currencyToCountry: Record<string, string> = {
    GHS: 'GH',
    NGN: 'NG',
    KES: 'KE',
    ZAR: 'ZA',
    USD: 'US',
    GBP: 'GB',
    EUR: 'EU',
  };
  return currencyToCountry[currency.toUpperCase()] || 'GH';
}

/**
 * Get dynamic payment method logos based on country and method
 * Returns URLs to logo images that should be displayed for the payment method
 */
export function getMethodLogos(country: string, method: string): string[] {
  const c = country.toUpperCase();

  const LOGOS = {
    visa: resolveAssetSrc(visaLogo),
    mastercard: resolveAssetSrc(mastercardLogo),
    apple_pay: resolveAssetSrc(applePayLogo),
    google_pay: resolveAssetSrc(googlePayLogo),
    mtn: resolveAssetSrc(mtnLogo),
    telecel: resolveAssetSrc(telecelLogo),
    airteltigo: resolveAssetSrc(airteltigoLogo),
    mpesa: resolveAssetSrc(mpesaLogo),
  };

  if (method === 'card') {
    return [LOGOS.visa, LOGOS.mastercard].filter(Boolean) as string[];
  }

  if (method === 'apple_pay') return [LOGOS.apple_pay].filter(Boolean) as string[];
  if (method === 'google_pay') return [LOGOS.google_pay].filter(Boolean) as string[];

  if (method === 'mobile_money') {
    if (c === 'GH') return [LOGOS.mtn, LOGOS.telecel, LOGOS.airteltigo].filter(Boolean) as string[];
    if (c === 'KE') return [LOGOS.mpesa].filter(Boolean) as string[];
    if (c === 'NG') return [LOGOS.mtn].filter(Boolean) as string[];
    return [LOGOS.mtn].filter(Boolean) as string[];
  }

  return [];
}
