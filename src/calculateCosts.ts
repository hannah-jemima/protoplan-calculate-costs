import {
  TProtocolRowCosts,
  TUnitConversions,
  TUnits,
  TProtocolRowCostCalculationData } from "@protoplan/types";
import { retrieveExchangeRate } from "@protoplan/exchange-rates";
import { getUnitConversionFactor } from "@protoplan/unit-utils";


export async function calculateCostsAndRepurchases<T extends TProtocolRowCostCalculationData>(
  data: T[],
  units: TUnits,
  unitConversions: TUnitConversions)
{
  const protocolWithProductsPerMonth = data.map(row =>
  {
    const productsPerMonth = calculateProductsPerMonth(row, units, unitConversions);

    return { ...row, productsPerMonth };
  });

  const protocolWithCosts = await Promise.all(protocolWithProductsPerMonth.map(async row =>
  {
    const bundleRows = protocolWithProductsPerMonth.filter(r =>
      row.bundleId ? (r.bundleId === row.bundleId) : (r.protocolId === row.protocolId));
    const listingsPerMonth = Math.max(...bundleRows.map(r => r.productsPerMonth / r.quantity));
    const repurchase = calculateRepurchase(listingsPerMonth);
    const {
      exchangeRate,
      priceWithTax,
      costPerMonth } = await calculateCostPerMonth({ ...row, listingsPerMonth });
    const  { maxListingsPerOrder, ordersPerMonth, feesPerMonth } = await calculatePerOrderFeePerMonth({
      ...row,
      exchangeRate,
      priceWithTax,
      listingsPerMonth,
      costPerMonth });

    return {
      ...row,
      listingsPerMonth,
      repurchase,
      exchangeRate,
      priceWithTax,
      costPerMonth,
      maxListingsPerOrder,
      ordersPerMonth,
      feesPerMonth };
  }));

  return protocolWithCosts;
}

export function calculateProductsPerMonth(
  row: {
    productId: number,
    amount: number,
    amountUnitId: number,
    dosesPerDay: number,
    daysPerMonth: number,
    dose: number,
    doseUnitId: number },
  units: TUnits,
  unitConversions: TUnitConversions)
{
  const amount = Number(row.amount);
  const dose = Number(row.dose);
  const dosesPerDay = Number(row.dosesPerDay);
  const daysPerMonth = Number(row.daysPerMonth);
  const unitConversionFactor = getUnitConversionFactor(
    row.doseUnitId,
    row.amountUnitId,
    row.productId,
    units,
    unitConversions);

  return (
    dose *
    dosesPerDay *
    daysPerMonth *
    unitConversionFactor /
    amount);
}

function calculateRepurchase(listingsPerMonth: number)
{
  const avgDaysPerMonth = 365.24 / 12;

  return (avgDaysPerMonth / listingsPerMonth);
}

async function calculateCostPerMonth(row: {
  nBundleProducts: number,
  listingsPerMonth: number,
  bundleId: number | null,
  quantity: number,
  price: number,
  deliveryPerListing: number | null,
  userCurrencyCode: string,
  listingCurrencyCode: string,
  taxPercent: number,
  baseTax: number,
  userCountryId: number,
  vendorCountryId: number })
{
  // Calculate listing price with per-listing taxes & exchange rate
  const { exchangeRate, priceWithTax } = await calculateListingCost(row);

  let costPerMonth = (priceWithTax * row.listingsPerMonth) || 0;

  if(row.bundleId)
    costPerMonth *= row.quantity / row.nBundleProducts;

  return { exchangeRate: Number(exchangeRate), priceWithTax, costPerMonth };
}

export async function calculateListingCost(row: {
  price: number,
  deliveryPerListing: number | null,
  userCurrencyCode: string,
  listingCurrencyCode: string,
  taxPercent: number,
  baseTax: number,
  userCountryId: number,
  vendorCountryId: number }, includeBaseTax = false)
{
  const price = row.price;
  // Amazon - shown on listing page in vendor's currency
  const deliveryPerListing = row.deliveryPerListing || 0;
  const userCurrencyCode = row.userCurrencyCode;
  const listingCurrencyCode = row.listingCurrencyCode;

  const exchangeRate = await retrieveExchangeRate(listingCurrencyCode, userCurrencyCode);

  // Calculate listing price with per-listing taxes & exchange rate
  // Per-product delivery costs are also taxed
  const priceWithTax = (
    (price + deliveryPerListing) * (1 + row.taxPercent / 100) +
    (includeBaseTax ? row.baseTax : 0)) * exchangeRate;

  return { exchangeRate, priceWithTax };
}






////////////// Per-Order Fees //////////////////////////////////////////////////////////////////////

type TOrderFeeCalculationData = {
  exchangeRate: number,
  quantity: number,
  nBundleProducts: number,
  deliveryPrice: number,
  basketLimit: number,
  priceWithTax: number,
  baseTax: number,
  listingsPerMonth: number };

// Accounting for per-order charges (delivery, base tax, customs), would it be cheaper?
export async function calculatePerOrderFeePerMonth<T>(data: T & TOrderFeeCalculationData)
{
  const maxListingsPerOrder = Math.floor(data.basketLimit / data.priceWithTax) || 1;
  const ordersPerMonth = data.listingsPerMonth / maxListingsPerOrder;

  // Delivery price shown in vendor's currency, base tax shown in user's currency
  // Fees per month calculated in user's currency
  const feesPerMonth =
    (Number(data.deliveryPrice) * data.exchangeRate + data.baseTax) *
    ordersPerMonth *
    data.quantity /
    data.nBundleProducts;

  return { maxListingsPerOrder, ordersPerMonth, feesPerMonth };
}

export function sortProtocol(protocol: { priority: number }[])
{
  return protocol.map(r => ({ ...r })).sort((a, b) => a.priority - b.priority);
}




/////// Total Costs ///////////////



export async function calculateTotalCosts(rows: TProtocolRowCosts[])
{
  const costPerMonth = rows.reduce((cost, row) => cost += row.costPerMonth || 0, 0);
  const feesPerMonth = rows.reduce((fees, row) => fees += row.feesPerMonth || 0, 0);

  return { costPerMonth, feesPerMonth };
}
