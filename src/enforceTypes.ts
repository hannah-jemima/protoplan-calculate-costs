


export function enforceProtocolRowTypes(r: {
  price: number,
  baseTax: number,
  taxPercent: number,
  deliveryPrice: number,
  amount: number })
{
  return {
    ...r,
    price: Number(r.price),
    baseTax: Number(r.baseTax),
    taxPercent: Number(r.taxPercent),
    deliveryPrice: Number(r.deliveryPrice),
    amount: Number(r.amount) };
}
