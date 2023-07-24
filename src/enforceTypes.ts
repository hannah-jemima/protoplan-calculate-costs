import { IBundleSaving, IDiscount, TSavingRow } from '@protoplan/types';

interface IEnforceTypesBase
{
  price: number,
  discountedPrice?: number,
  baseTax?: number,
  taxPercent?: number,
  salesTax?: number,
  deliveryPrice?: number,
  amount: number,
  amountUnit: string,
  scrapeTime?: Date | null,
  basketLimit?: number | null
}

export interface IEnforcableTypes extends IEnforceTypesBase
{
  inaccessible: number | null | boolean,
  discounts?: IDiscount[]
}

export interface IEnforcableProps extends IEnforcableTypes
{
  listingSavings?: TSavingRow[] | null,
  bundleSavings?: IBundleSaving[] | null
}

export function enforceProtocolTypes<T>(rows: (T & IEnforcableProps)[])
{
  return rows.map(r => ({
    ...enforceProtocolRowTypes(r),
    listingSavings: r.listingSavings?.map(ls => enforceProtocolRowTypes(ls)),
    bundleSavings: r.bundleSavings?.map(bs => ({
      ...bs,
      replacableRows: bs.replacableRows.map(r => enforceProtocolRowTypes(r)),
      bundle: bs.bundle.map(r => enforceProtocolRowTypes(r)),
      leftoverProducts: bs.leftoverProducts.map(r => enforceProtocolRowTypes(r)) })) as IBundleSaving[] | undefined}));
}

function enforceProtocolRowTypes<T>(row: T & IEnforcableTypes)
{
  return {
    ...row,
    price: Number(row.price),
    discountedPrice: row.discountedPrice !== undefined ? Number(row.discountedPrice) : undefined,
    baseTax: row.baseTax !== undefined ? Number(row.baseTax) : undefined,
    taxPercent: row.taxPercent !== undefined ? Number(row.taxPercent) : undefined,
    salesTax: row.salesTax !== undefined ? Number(row.salesTax) : undefined,
    deliveryPrice: row.deliveryPrice !== undefined ? Number(row.deliveryPrice) : undefined,
    amount: Number(row.amount),
    amountUnit: String(row.amountUnit),
    scrapeTime: row.scrapeTime ? new Date(row.scrapeTime) : row.scrapeTime,
    basketLimit: row.basketLimit ? Number(row.basketLimit) : row.basketLimit,
    inaccessible: row.inaccessible === 1,
    discounts: row.discounts?.map(d => ({ ...d, savingPercent: Number(d.savingPercent) })) };
}

export function enforceListingTypes<T>(listings: (T & IEnforcableProps & { priceWithTax: number })[])
{
  return enforceProtocolTypes(listings).map(l => ({
    ...l,
    priceWithTax: Number(l.priceWithTax) }));
}
