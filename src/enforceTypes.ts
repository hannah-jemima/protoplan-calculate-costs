import { TProtocolRowCosts } from "@protoplan/types";




export function enforceProtocolRowTypes(r: TProtocolRowCosts)
{
  return {
    ...r,
    price: Number(r.price),
    baseTax: Number(r.baseTax),
    taxPercent: Number(r.taxPercent),
    deliveryPrice: Number(r.deliveryPrice),
    amount: Number(r.amount) };
}
