import { IBundleSaving } from '@protoplan/types';

interface IEnforceTypesBase
{
  price: number,
  baseTax?: number,
  taxPercent?: number,
  deliveryPrice?: number,
  amount: number,
  amountUnit: string,
  scrapeTime?: Date | null,
  basketLimit?: number | null,
}

interface IEnforcableTypes extends IEnforceTypesBase
{
  inaccessible: number | null | boolean
}

interface IEnforcedTypes extends IEnforceTypesBase
{
  inaccessible: boolean
}

interface IEnforcableProps extends IEnforcableTypes
{
  bundleSavings?: IBundleSaving[] | null
}

export function enforceProtocolTypes<T>(rows: (T & IEnforcableProps)[])
{
  return rows.map(r => ({
    ...enforceProtocolRowTypes(r),
    bundleSavings: r.bundleSavings?.map(s => ({
      ...s,
      replacableRows: s.replacableRows.map(r => enforceProtocolRowTypes(r)),
      bundle: s.bundle.map(r => enforceProtocolRowTypes(r)),
      leftoverProducts: s.leftoverProducts.map(r => enforceProtocolRowTypes(r)) })) }));
}

function enforceProtocolRowTypes<T>(row: T & IEnforcableTypes)
{
  return {
    ...row,
    price: Number(row.price),
    baseTax: row.baseTax !== undefined ? Number(row.baseTax) : undefined,
    taxPercent: row.taxPercent !== undefined ? Number(row.taxPercent) : undefined,
    deliveryPrice: row.deliveryPrice !== undefined ? Number(row.deliveryPrice) : undefined,
    amount: Number(row.amount),
    amountUnit: String(row.amountUnit),
    scrapeTime: row.scrapeTime ? new Date(row.scrapeTime) : row.scrapeTime,
    basketLimit: row.basketLimit ? Number(row.basketLimit) : row.basketLimit,
    inaccessible: row.inaccessible === true || row.inaccessible === 1 } as (T & IEnforcedTypes);
}

export function enforceListingTypes<T>(listings: (T & IEnforcableProps & { priceWithTax: number })[])
{
  return enforceProtocolTypes(listings).map(l => ({
    ...l,
    priceWithTax: Number(l.priceWithTax) }));
}
