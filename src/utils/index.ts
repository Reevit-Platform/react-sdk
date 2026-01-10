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
