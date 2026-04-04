export function validateNPI(npi: string): boolean {
  if (!/^\d{10}$/.test(npi)) return false;
  const withPrefix = '80840' + npi;
  let sum = 0;
  for (let i = 0; i < withPrefix.length; i++) {
    let digit = parseInt(withPrefix[withPrefix.length - 1 - i]);
    if (i % 2 === 1) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  return sum % 10 === 0;
}
