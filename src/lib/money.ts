export function moneyToNumber(value: { toString(): string } | number | string) {
  return Number(value.toString());
}

export function paiseFromRupees(value: { toString(): string } | number | string) {
  return Math.round(moneyToNumber(value) * 100);
}
