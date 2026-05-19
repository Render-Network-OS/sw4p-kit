const TRON_ADDRESS_PATTERN = /^T[1-9A-HJ-NP-Za-km-z]{32,33}$/;

export function isTronAddressFormat(addr: string): boolean {
  if (!addr || addr.length < 33 || addr.length > 34) return false;
  return TRON_ADDRESS_PATTERN.test(addr);
}

export function assertTronAddressFormat(addr: string): void {
  if (!isTronAddressFormat(addr)) {
    throw new Error(`Not a valid Tron address format: ${addr}`);
  }
}
