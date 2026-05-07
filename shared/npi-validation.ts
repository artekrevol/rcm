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

export function validateNpiOrThrow(npi: string): void {
  if (!npi || npi.trim() === '') {
    throw new Error('NPI is required');
  }
  if (!/^\d{10}$/.test(npi)) {
    throw new Error(
      `NPI "${npi}" is invalid: must be exactly 10 numeric digits (got ${npi.length} char(s))`
    );
  }
  if (!validateNPI(npi)) {
    throw new Error(
      `NPI "${npi}" fails the CMS Luhn check digit validation. ` +
      `Verify the NPI at https://npiregistry.cms.hhs.gov/`
    );
  }
}
