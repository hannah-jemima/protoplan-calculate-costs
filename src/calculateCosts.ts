import { TProtocol, TProtocolRowCosts } from "@protoplan/types";
import { retrieveExchangeRate } from "./currency.js";
import { TUnitConversions, TUnits } from "@protoplan/types";
import { getUnitConversionFactor } from "@protoplan/unit-utils";


export async function calculateCostsAndRepurchases(
  data: TProtocolRowCosts[],
  units: TUnits,
  unitConversions: TUnitConversions)
{
  const protocolWithProductsPerMonth = data.map(row =>
  {
    const productsPerMonth = calculateProductsPerMonth(row, units, unitConversions);

    return { ...row, productsPerMonth };
  });

  return Promise.all(protocolWithProductsPerMonth.map(async row =>
  {
    const bundleRows = protocolWithProductsPerMonth.filter(r =>
      row.bundleId ? (r.bundleId === row.bundleId) : (r.protocolId === row.protocolId));
    const listingsPerMonth = Math.max(...bundleRows.map(r => r.productsPerMonth / r.quantity));
    const repurchase = calculateRepurchase(listingsPerMonth);
    const { exchangeRate, cost, costPerMonth } = await calculateCostPerMonth({ ...row, listingsPerMonth });
    const feesPerMonth = await calculatePerOrderFeePerMonth({
      ...row,
      cost,
      listingsPerMonth,
      costPerMonth });

    return { ...row, listingsPerMonth, repurchase, exchangeRate, cost, costPerMonth, feesPerMonth };
  }));
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
  deliveryPerProduct: number | null,
  userCurrencyCode: string,
  listingCurrencyCode: string,
  taxPercent: number | null,
  userCountryId: number,
  vendorCountryId: number,
  deliveryPrice: number | null })
{
  // Calculate listing price with per-listing taxes & exchange rate
  const { exchangeRate, cost } = await calculateCost(row);

  let costPerMonth = (cost * row.listingsPerMonth) || 0;

  if(row.bundleId)
    costPerMonth *= row.quantity / row.nBundleProducts;

  return { exchangeRate, cost, costPerMonth };
}

export async function calculateCost(row: {
  price: number,
  deliveryPerProduct: number | null,
  userCurrencyCode: string,
  listingCurrencyCode: string,
  taxPercent: number | null,
  userCountryId: number,
  vendorCountryId: number,
  deliveryPrice: number | null })
{
  const gpbToUserCurrency = await retrieveExchangeRate('GBP', row.userCurrencyCode);
  const domestic = row.userCountryId === row.vendorCountryId;
  const price = row.price;
  // Amazon - shown on listing page in vendor's currency
  const deliveryPerProduct = row.deliveryPerProduct || 0;
  const freeDelivery = !deliveryPerProduct && (row.deliveryPrice === 0);
  const userCurrencyCode = row.userCurrencyCode;
  const listingCurrencyCode = row.listingCurrencyCode;
  const taxPercent = (row.taxPercent !== null) ?
    row.taxPercent :
    ((domestic || freeDelivery) ? 0 : (20 * gpbToUserCurrency));         // iHerb - Vendor-specific, on listing price in user's currency
  const exchangeRate = (userCurrencyCode && listingCurrencyCode && userCurrencyCode !== listingCurrencyCode) ?
    await retrieveExchangeRate(listingCurrencyCode, userCurrencyCode) :
    1;

  // Calculate listing price with per-listing taxes & exchange rate
  // Per-product delivery costs are also taxed
  const cost = (price + deliveryPerProduct) * exchangeRate * (1 + taxPercent / 100);

  return { exchangeRate, cost };
}






////////////// Per-Order Fees //////////////////////////////////////////////////////////////////////

type TOrderFeeCalculationData = {
  listingId: number,
  quantity: number,
  nBundleProducts: number,
  deliveryPrice: number,
  basketLimit: number,
  cost: number,
  deliveryPerProduct: number | null,
  baseTax: number | null,
  vendorCountryId: number,
  userCountryId: number,
  userCurrencyCode: string,
  listingsPerMonth: number,
  costPerMonth: number };

// Accounting for per-order charges (delivery, base tax, customs), would it be cheaper?
export async function calculatePerOrderFeePerMonth(data: TOrderFeeCalculationData)
{
  // All fees shown at checkout in user's currency
  const gpbToUserCurrency = await retrieveExchangeRate('GBP', data.userCurrencyCode);
  const domestic = data.userCountryId === data.vendorCountryId;

  const deliveryPerProduct = data.deliveryPerProduct || 0;
  const freeDelivery = !deliveryPerProduct && (data.deliveryPrice === 0);

  const maxListingsPerOrder = Math.floor(data.basketLimit / data.cost) || 1;
  const ordersPerMonth = data.listingsPerMonth / maxListingsPerOrder;

  const baseTax = (data.baseTax !== null) ? data.baseTax : ((domestic || freeDelivery) ? 0 : (20 * gpbToUserCurrency));

  console.log("feesPerMonth", data.deliveryPrice, baseTax, ordersPerMonth, data.quantity, data.nBundleProducts);
  return (data.deliveryPrice + baseTax) * ordersPerMonth * data.quantity / data.nBundleProducts;
}

export function sortProtocol(protocol: TProtocol)
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
