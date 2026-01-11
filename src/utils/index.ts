/**
 * Utility functions for the Reevit React SDK
 */

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
    vodafone: /^(0|233|\+233)?(20|50)\d{7}$/,
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
    vodafone: ['020', '050', '23320', '23350'],
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

  // CDN-hosted logos (using reliable sources)
  const LOGOS = {
    visa: 'https://js.stripe.com/v3/fingerprinted/img/visa-729c05c240c4bdb47b03ac81d9945bfe.svg',
    mastercard: 'https://js.stripe.com/v3/fingerprinted/img/mastercard-4d8844094130711885b5e41b28c9848f.svg',
    amex: 'https://js.stripe.com/v3/fingerprinted/img/amex-a49b82f46c5cd6a96a6e418a6ca1717c.svg',
    apple_pay: 'https://js.stripe.com/v3/fingerprinted/img/apple_pay_mark-ea40d9a0f83ff6c94c3aa5c2c1ba4427.svg',
    google_pay: 'https://js.stripe.com/v3/fingerprinted/img/google_pay_mark-ed0c5a85e00a6e95f57a3c89e9d2a69c.svg',
    mtn: 'https://play-lh.googleusercontent.com/WdLBv6Ck6Xk4VJQvPxODXXjLNmxEGHDnXML_TVqWOBBzXpWLV1K3xXlStCfFLrl0Tw=w240-h480-rw',
    vodafone: 'https://play-lh.googleusercontent.com/cTpsmMl_ZXKvPLKWwCvC0VaKgT1ISyH0fNDgVbXHMGJl4PYvGMnlFFe8Kj3vTqz0Xg=w240-h480-rw',
    airtel: 'https://play-lh.googleusercontent.com/Mh2OxhKPKMfxCn2Y7J3gD3TLvkvOeFXwPLLGqrDHD5qJ5le_ph7Y6PmfwwZKJMZWcYU=w240-h480-rw',
    mpesa: 'https://play-lh.googleusercontent.com/2wd-PssHqg1Xv0HnKzH7ecFfozXo_vr5M-Hf7k7X7kqxMGqj5PmKWnFhTqCYXCPCAYE=w240-h480-rw',
  };

  if (method === 'card') {
    return [LOGOS.visa, LOGOS.mastercard];
  }

  if (method === 'apple_pay') return [LOGOS.apple_pay];
  if (method === 'google_pay') return [LOGOS.google_pay];

  if (method === 'mobile_money') {
    if (c === 'GH') return [LOGOS.mtn, LOGOS.vodafone, LOGOS.airtel];
    if (c === 'KE') return [LOGOS.mpesa, LOGOS.airtel];
    if (c === 'NG') return [LOGOS.mtn, LOGOS.airtel];
    return [LOGOS.mtn];
  }

  return [];
}
