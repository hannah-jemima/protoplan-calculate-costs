import {
  TDosingCostCalculationData,
  IDiscount,
  Dosing,
  Amount } from "@protoplan/types";
import Units from "@protoplan/unit-utils/lib/Units";



export async function calculateCostsAndRepurchases<T extends Partial<TDosingCostCalculationData>>(
  dosings: T[],
  units: Units,
  retrieveExchangeRate: (fromCurrencyCode: string, toCurrencyCode: string) => Promise<number>)
{
  const dosingsWithListings = dosings
    .reduce((ds, d1) =>
    {
      const dWithListing = getDosingWithListing(d1);
      if(!dWithListing)
        return ds;

      return ds.concat(dWithListing);
    }, <(T & TDosingCostCalculationData)[]>[]);

  const dosingsWithCosts = await Promise.all(dosings.map(async dosing =>
  {
    const dosingWithListing = getDosingWithListing(dosing);
    if(!dosingWithListing)
    {
      return ({
        ...dosing,
        productsPerMonth: undefined,
        listingsPerMonth: undefined,
        repurchase: undefined,
        costPerMonth: undefined,
        maxListingsPerOrder: undefined,
        ordersPerMonth: undefined,
        feesPerMonth: undefined,
        exchangeRate: undefined,
        priceWithTax: undefined,
        discountedPrice: undefined });
    }

    // productsPerMonth represents the total amount required over a month for this row's dosage.
    const productsPerMonth = calculateProductsPerMonth(dosingWithListing, units);

    const bundleRows = dosingWithListing.bundleId ? dosingsWithListings
      .map(d1 => ({ ...d1, productsPerMonth }))
      .filter(r => (r.bundleId === dosingWithListing.bundleId)) : undefined;

    return await calculateCostAndRepurchase(dosingWithListing, units, retrieveExchangeRate, bundleRows);
  }));

  return dosingsWithCosts;
}

function getDosingWithListing<T extends Partial<TDosingCostCalculationData>>(dosing: T)
{
  if(
    !dosing.listingId ||
    !dosing.productId ||
    dosing.dose === undefined ||
    dosing.doseUnitId === undefined ||
    dosing.dosesPerDay === undefined ||
    dosing.daysPerMonth === undefined ||
    !dosing.amount ||
    !dosing.amountUnitId ||
    dosing.price === undefined ||
    !dosing.userCurrencyCode ||
    !dosing.listingCurrencyCode ||
    !dosing.vendorCountryId ||
    !dosing.userCountryId)
  {
    return;
  }

  return ({
    ...dosing,
    listingId: Number(dosing.listingId),
    productId: Number(dosing.productId),
    amount: Number(dosing.amount),
    amountUnitId: Number(dosing.amountUnitId),
    price: Number(dosing.price),
    dose: Number(dosing.dose),
    doseUnitId: Number(dosing.doseUnitId),
    dosesPerDay: Number(dosing.dosesPerDay),
    daysPerMonth: Number(dosing.daysPerMonth),
    vendorCountryId: Number(dosing.vendorCountryId),
    listingCurrencyCode: String(dosing.listingCurrencyCode),
    userCountryId: Number(dosing.userCountryId),
    userCurrencyCode: String(dosing.userCurrencyCode) });
}

export async function calculateCostAndRepurchase<T extends TDosingCostCalculationData>(
  dosing: T,
  units: Units,
  retrieveExchangeRate: (fromCurrencyCode: string, toCurrencyCode: string) => Promise<number>,
  bundleRows?: (T & { productsPerMonth: number })[])
{
  // Represents the total amount required over a month for this row's dosage.
  const productsPerMonth = calculateProductsPerMonth(dosing, units);

  const rowsInBundle = bundleRows || [{ ...dosing, productsPerMonth }];

  // Represents the total amount to cover all dosings of a bundle product
  // (required in case bundle product is split across multiple protocol rows for multiple dosing strategies)
  const totalProductsPerMonth = rowsInBundle
    .filter(r => r.productId === dosing.productId)
    .reduce((pTot, br) => pTot + Number(br.productsPerMonth), 0);

  // Proportion of product in this row vs. across all rows
  const amountProportion = productsPerMonth / totalProductsPerMonth // of bundle product

  // Listings per month determined by highest amount of product required out of the bundle
  const listingsPerMonth = Math.max(...rowsInBundle.map(r => productsPerMonth / (r.quantity || 1)));

  const dosingWithCostPerMonth = await calculateCostPerMonth({
      ...dosing,
      listingsPerMonth,
      amountProportion },
    retrieveExchangeRate);

  const dosingWithFeesPerMonth = await calculatePerOrderFeePerMonth({
    ...dosingWithCostPerMonth,
    listingsPerMonth, });

  const repurchase = calculateRepurchase(listingsPerMonth);

  return { ...dosingWithFeesPerMonth, productsPerMonth, listingsPerMonth, repurchase };
}

export function calculateProductsPerMonth(row: { productId: number } & Amount & Dosing, units: Units)
{
  const amount = Number(row.amount);
  const dose = Number(row.dose);
  const dosesPerDay = Number(row.dosesPerDay);
  const daysPerMonth = Number(row.daysPerMonth);
  const unitConversionFactor = units.getFactor(row.doseUnitId, row.amountUnitId, row.productId);
  if(!unitConversionFactor)
  {
    console.error("calculateProductsPerMonth: no unit conversion factor found " +
      "fromUnitId", row.doseUnitId,
      "toUnitId", row.amountUnitId)
  }

  return (
    dose *
    dosesPerDay *
    daysPerMonth *
    (unitConversionFactor || 1) /
    amount);
}

function calculateRepurchase(listingsPerMonth: number)
{
  const avgDaysPerMonth = 365.24 / 12;

  return (avgDaysPerMonth / listingsPerMonth);
}

interface IListingCostCalculationData
{
  listingId: number,
  price: number,
  deliveryPerListing?: number,
  userCurrencyCode: string,
  listingCurrencyCode: string,
  exchangeRate?: number,
  taxPercent?: number,
  baseTax?: number,
  salesTax?: number,
  vendorCountryId: number,
  userCountryId: number,
  discounts?: IDiscount[],
}

interface IListingQuantity
{
  listingsPerMonth: number
}

interface IBundleQuantity
{
  bundleId?: number,
  quantity: number,
  nBundleProducts: number,
  amountProportion?: number,
}

export async function calculateCostPerMonth<T>(
  listingQuantity: T & IListingCostCalculationData & Partial<IBundleQuantity> & IListingQuantity,
  retrieveExchangeRate: (fromCurrencyCode: string, toCurrencyCode: string) => Promise<number>)
{
  // Calculate listing price with per-listing taxes & exchange rate
  const listingWithPrice = await calculateListingCost(listingQuantity, retrieveExchangeRate);

  let costPerMonth = (listingWithPrice.priceWithTax * listingQuantity.listingsPerMonth) || 0;

  // Apportion costPerMonth by:
  //   - quantity of product in bundle
  //   - the dose proportion of a bundle product in this row, where it is split across multiple rows
  //     (for different dosing dtrategies)
  if(listingQuantity.bundleId)
  {
    costPerMonth *=
      (listingQuantity.quantity || 1) *
      (listingQuantity.amountProportion || 1) /
      (listingQuantity.nBundleProducts || 1);
  }

  return { ...listingWithPrice, costPerMonth };
}

export async function calculateListingCost<T>(
  row: T & IListingCostCalculationData,
  retrieveExchangeRate: (fromCurrencyCode: string, toCurrencyCode: string) => Promise<number>,
  includeBaseTax = false)
{
  const price = row.price;
  // Amazon - shown on listing page in vendor's currency
  const deliveryPerListing = row.deliveryPerListing || 0;
  const baseTax = row.baseTax || 0;
  const taxPercent = row.taxPercent || 0;
  const userCurrencyCode = row.userCurrencyCode;
  const listingCurrencyCode = row.listingCurrencyCode;
  const exchangeRate = row.exchangeRate || await retrieveExchangeRate(listingCurrencyCode, userCurrencyCode);
  const salesTax = (
    row.vendorCountryId === 2 &&
    row.userCountryId === 2 &&
    listingCurrencyCode === "USD" &&
    row.salesTax) ? row.salesTax : 0;

  const discountedPrice = row.discounts ? row.discounts
    .filter(d => d.applied)
    .reduce((dp, d) => dp * (100 - d.savingPercent) / 100, price) : price;

  // Calculate listing price with per-listing taxes & exchange rate
  // Per-product delivery costs are also taxed
  const priceWithTax = (
    (discountedPrice + deliveryPerListing) * (1 + taxPercent / 100) * (1 + salesTax / 100) +
    (includeBaseTax ? baseTax : 0)) * exchangeRate;

  return { ...row, exchangeRate, discountedPrice, priceWithTax };
}






////////////// Per-Order Fees //////////////////////////////////////////////////////////////////////

type TOrderFeeCalculationData = {
  exchangeRate: number,
  quantity?: number,
  nBundleProducts?: number,
  deliveryPrice?: number,
  basketLimit?: number,
  priceWithTax: number,
  baseTax?: number,
  listingsPerMonth: number };

// Accounting for per-order charges (delivery, base tax, customs), would it be cheaper?
export async function calculatePerOrderFeePerMonth<T>(data: T & TOrderFeeCalculationData)
{
  const maxListingsPerOrder = data.basketLimit ? Math.floor(data.basketLimit / data.priceWithTax) || 1 : 1;
  const ordersPerMonth = data.listingsPerMonth / maxListingsPerOrder;

  // Delivery price shown in vendor's currency, base tax shown in user's currency
  // Fees per month calculated in user's currency
  const feesPerMonth =
    (Number(data.deliveryPrice) * data.exchangeRate + Number(data.baseTax)) *
    ordersPerMonth *
    (data.quantity || 1) /
    (data.nBundleProducts || 1);

  console.log(
    "deliveryPrice", data.deliveryPrice,
    "exchangeRate", data.exchangeRate,
    "baseTax", Number(data.baseTax),
    "ordersPerMonth", ordersPerMonth,
    "quantity", data.quantity,
    "nBundleProducts", data.nBundleProducts,
    "nBundleProducts || 1", (data.nBundleProducts || 1),
    "basketLimit",data.basketLimit,
    "priceWithTax", data.priceWithTax,
    "listingsPerMonth", data.listingsPerMonth,
    "feesPerMonth", feesPerMonth);

  return { ...data, maxListingsPerOrder, ordersPerMonth, feesPerMonth };
}

export function sortDosings(dosings: { priority: number }[])
{
  return dosings.map(r => ({ ...r })).sort((a, b) => a.priority - b.priority);
}




/////// Total Costs ///////////////



export async function calculateTotalCosts(rows: { costPerMonth?: number, feesPerMonth?: number }[])
{
  const costPerMonth = rows.reduce((cost, row) => cost += row.costPerMonth || 0, 0);
  const feesPerMonth = rows.reduce((fees, row) => fees += row.feesPerMonth || 0, 0);

  return { costPerMonth, feesPerMonth };
}
