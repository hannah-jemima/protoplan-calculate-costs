


export function enforceProtocolRowTypes<T>(r: T & {
  price: number,
  baseTax?: number,
  taxPercent?: number,
  deliveryPrice?: number,
  amount?: number,
  scrapeTime?: Date | null })
{
  return {
    ...r,
    price: Number(r.price),
    baseTax: r.baseTax !== undefined ? Number(r.baseTax) : undefined,
    taxPercent: r.taxPercent !== undefined ? Number(r.taxPercent) : undefined,
    deliveryPrice: r.deliveryPrice !== undefined ? Number(r.deliveryPrice) : undefined,
    amount: r.amount !== undefined ? Number(r.amount) : undefined,
    scrapeTime: r.scrapeTime ? new Date(r.scrapeTime) : r.scrapeTime };
}