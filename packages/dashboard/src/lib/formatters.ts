/**
 * Smart Number Formatting Utilities
 * Format numbers with K/M suffixes for clean display
 */

/**
 * Format numbers with smart K/M suffixes
 * 0-999: as-is (e.g., "495")
 * 1,000-999,999: with k suffix (e.g., "1k", "1.1k", "1.89k")
 * 1,000,000+: with M suffix (e.g., "1M", "1.5M", "1.89M")
 */
export function formatCompactNumber(num: number, decimals: number = 2): string {
  if (num < 1000) {
    return num.toString();
  } else if (num < 1000000) {
    const value = num / 1000;
    // Remove trailing zeros: 1.00k -> 1k, 1.50k -> 1.5k, 1.89k -> 1.89k
    const formatted = value.toFixed(decimals).replace(/\.?0+$/, '');
    return `${formatted}k`;
  } else {
    const value = num / 1000000;
    const formatted = value.toFixed(decimals).replace(/\.?0+$/, '');
    return `${formatted}M`;
  }
}

/**
 * Format currency with smart K/M suffixes
 * $0-$999.99: full precision (e.g., "$495.28")
 * $1,000-$999,999: with k suffix (e.g., "$1k", "$1.5k", "$1.89k")
 * $1,000,000+: with M suffix (e.g., "$1M", "$1.5M", "$1.89M")
 */
export function formatCompactCurrency(num: number, decimals: number = 2): string {
  if (num < 1000) {
    return `$${num.toFixed(2)}`;
  } else if (num < 1000000) {
    const value = num / 1000;
    const formatted = value.toFixed(decimals).replace(/\.?0+$/, '');
    return `$${formatted}k`;
  } else {
    const value = num / 1000000;
    const formatted = value.toFixed(decimals).replace(/\.?0+$/, '');
    return `$${formatted}M`;
  }
}

/**
 * Format a number with commas for readability
 * e.g., 1234567 -> "1,234,567"
 */
export function formatWithCommas(num: number): string {
  return num.toLocaleString();
}
