import {
  IDiscount,
  Dosing,
  Amount,
  DosingCostCalculationData } from "@protoplan/types";



export async function calculateCostsAndRepurchases<
  T extends Partial<DosingCostCalculationData & { priority: number }>>(
  dosings: T[],
  retrieveExchangeRate: (fromCurrencyCode: string, toCurrencyCode: string) => Promise<number>)
{
  const dosingsWithListings = dosings
    .reduce((ds, d1) =>
    {
      const dWithListing = getDosingWithListing(d1);
      if(!dWithListing)
        return ds;

      return ds.concat(dWithListing);
    }, <(T & DosingCostCalculationData)[]>[]);

  const dosingsWithCosts = await Promise.all(dosings.map(async dosing =>
  {
    const dosingWithProduct = getDosingWithProduct(dosing);
    const dosingWithListing = dosingWithProduct ? getDosingWithListing(dosingWithProduct) : undefined;
    if(!dosingWithListing)
    {
      const productsPerMonth = dosingWithProduct ?
        await calculateProductsPerMonth(dosingWithProduct) :
        undefined;

      return ({
        ...dosing,
        productsPerMonth,
        listingsPerMonth: undefined,
        repurchase: productsPerMonth ? calculateRepurchase(productsPerMonth) : undefined,
        costPerMonthWithFees: undefined,
        costPerMonthWithoutFees: undefined,
        maxListingsPerOrder: undefined,
        ordersPerMonth: undefined,
        exchangeRate: undefined,
        priceWithFees: undefined,
        priceWithoutFees: undefined,
        discountedPrice: undefined });
    }

    const bundleRows = dosingWithListing.bundleId ?
      await Promise.all(dosingsWithListings
        .filter(r => (r.bundleId === dosingWithListing.bundleId))
        .map(async d1 => ({ ...d1, productsPerMonth: await calculateProductsPerMonth(d1) }))) :
      [{ ...dosing, productsPerMonth: await calculateProductsPerMonth(dosingWithListing) }];

    // Only show cost for highest priority row in bundle
    const highestPriority = bundleRows.map(r => r.priority || 0).sort()[0];
    const highestPriorityBundleRow = dosing.priority === highestPriority;

    // Listings per month determined by highest amount of product required out of the bundle
    const listingsPerMonth = Math.max(...bundleRows.map(r => r.productsPerMonth / (r.quantity || 1)));

    return await calculateCostAndRepurchase(
      { ...dosingWithListing, listingsPerMonth } ,
      retrieveExchangeRate,
      highestPriorityBundleRow);
  }));

  return dosingsWithCosts;
}

function getDosingWithListing<T extends Partial<DosingCostCalculationData>>(dosing: T)
{
  const dosingWithProduct = getDosingWithProduct(dosing);

  if(
    !dosingWithProduct ||
    !dosingWithProduct.listingId ||
    dosingWithProduct.price === undefined ||
    !dosingWithProduct.basketLimit ||
    !dosingWithProduct.vendorCurrencyCode ||
    !dosingWithProduct.listingCurrencyCode ||
    !dosingWithProduct.vendorCountryId)
  {
    return;
  }

  return ({
    ...dosingWithProduct,
    listingId: Number(dosingWithProduct.listingId),
    price: Number(dosingWithProduct.price),
    basketLimit: Number(dosingWithProduct.basketLimit),
    vendorCountryId: Number(dosingWithProduct.vendorCountryId),
    vendorCurrencyCode: String(dosingWithProduct.vendorCurrencyCode),
    listingCurrencyCode: String(dosingWithProduct.listingCurrencyCode),
    baseTax: Number(dosingWithProduct.baseTax) });
}

function getDosingWithProduct<T extends Partial<DosingCostCalculationData>>(dosing: T)
{
  if(
    !dosing.productId ||
    dosing.dose === undefined ||
    dosing.doseUnitId === undefined ||
    dosing.dosesPerDay === undefined ||
    dosing.daysPerMonth === undefined ||
    !dosing.factor ||
    !dosing.amount ||
    !dosing.amountUnitId ||
    !dosing.userCurrencyCode ||
    !dosing.userCountryId)
  {
    return;
  }

  return ({
    ...dosing,
    productId: Number(dosing.productId),
    amount: Number(dosing.amount),
    amountUnitId: Number(dosing.amountUnitId),
    factor: Number(dosing.factor),
    dose: Number(dosing.dose),
    doseUnitId: Number(dosing.doseUnitId),
    dosesPerDay: Number(dosing.dosesPerDay),
    daysPerMonth: Number(dosing.daysPerMonth),
    userCountryId: Number(dosing.userCountryId),
    userCurrencyCode: String(dosing.userCurrencyCode),
    protocolCurrencyCode: String(dosing.protocolCurrencyCode || dosing.userCurrencyCode) });
}

export async function calculateCostAndRepurchase<
  T extends DosingCostCalculationData & Partial<ListingQuantity>>(
  dosing: T,
  retrieveExchangeRate: (fromCurrencyCode: string, toCurrencyCode: string) => Promise<number>,
  bundlePriorityProduct = true)
{
  // Represents the total amount required over a month for this row's dosage.
  const productsPerMonth = await calculateProductsPerMonth(dosing);

  // Listings per month determined by highest amount of product required out of the bundle
  const listingsPerMonth = dosing.listingsPerMonth || productsPerMonth;

  const dosingWithCostPerMonth = await calculateCostPerMonth({
      ...dosing,
      listingsPerMonth },
    retrieveExchangeRate);

  const repurchase = calculateRepurchase(listingsPerMonth);

  return {
    ...dosingWithCostPerMonth,
    productsPerMonth,
    // Only show costs for highest priority row in bundle
    costPerMonthWithFees: bundlePriorityProduct ?
      dosingWithCostPerMonth.costPerMonthWithFees :
      undefined,
    costPerMonthWithoutFees: bundlePriorityProduct ?
      dosingWithCostPerMonth.costPerMonthWithoutFees :
      undefined,
    listingsPerMonth: bundlePriorityProduct ? listingsPerMonth : undefined,
    repurchase: bundlePriorityProduct ? repurchase : undefined };
}

export async function calculateProductsPerMonth(row: { productId: number, factor: number } & Amount & Dosing)
{
  return (
    row.dose *
    row.dosesPerDay *
    row.daysPerMonth *
    (row.factor || 1) /
    row.amount);
}

function calculateRepurchase(listingsPerMonth: number)
{
  const avgDaysPerMonth = 365.24 / 12;

  return (avgDaysPerMonth / listingsPerMonth);
}

interface ListingCostCalculationData
{
  listingId: number,
  price: number,
  deliveryPerListing?: number,
  userCurrencyCode: string,
  protocolCurrencyCode?: string;
  vendorCurrencyCode: string;
  listingCurrencyCode: string,
  exchangeRate?: number,
  taxPercent?: number,
  salesTax?: number,
  vendorCountryId: number,
  userCountryId: number,
  discounts?: IDiscount[],
}

interface ListingQuantity
{
  listingsPerMonth: number
}

interface FeesCalculationData extends ListingCostCalculationData
{
  deliveryPrice?: number,
  basketLimit: number,
  baseTax: number
};

interface BundleQuantity
{
  bundleId?: number,
  quantity: number,
}

export async function calculateCostPerMonth<T>(
  dosing: T & FeesCalculationData & ListingQuantity & Partial<BundleQuantity>,
  retrieveExchangeRate: (fromCurrencyCode: string, toCurrencyCode: string) => Promise<number>)
{
  // Calculate listing price with per-listing taxes & exchange rate
  const listingWithPrice = await calculateListingCostWithFees(
    dosing,
    retrieveExchangeRate);

  const ordersPerMonth = dosing.listingsPerMonth / listingWithPrice.maxListingsPerOrder;

  const costPerMonthWithoutFees = (
    listingWithPrice.priceWithoutFees *
    dosing.listingsPerMonth) || 0;

  const costPerMonthWithFees = (
    listingWithPrice.priceWithFees *
    dosing.listingsPerMonth) || 0;

  return { ...listingWithPrice, costPerMonthWithoutFees, costPerMonthWithFees, ordersPerMonth };
}

export async function calculateListingCostWithoutFees<T>(
  row: T & ListingCostCalculationData,
  retrieveExchangeRate: (fromCurrencyCode: string, toCurrencyCode: string) => Promise<number>)
{
  const protocolCurrencyCode = row.protocolCurrencyCode || row.userCurrencyCode;
  const listingToProtocolCurrency =
    row.exchangeRate ||
    await retrieveExchangeRate(row.listingCurrencyCode, protocolCurrencyCode);

  const discountedPrice = row.discounts ? row.discounts
    .filter(d => d.applied)
    .reduce((dp, d) => dp * (100 - d.savingPercent) / 100, row.price) : row.price;

  // Calculate listing price with per-listing taxes & exchange rate
  // Per-product delivery costs are also taxed
  // Base tax shown in user's currency
  const priceWithoutFees = discountedPrice * listingToProtocolCurrency;

  return { ...row, exchangeRate: listingToProtocolCurrency, discountedPrice, priceWithoutFees };
}

export async function calculateListingCostWithFees<T>(
  row0: T & FeesCalculationData,
    retrieveExchangeRate: (fromCurrencyCode: string, toCurrencyCode: string) => Promise<number>,
  includeOrderFees = true)
{
  const row = await calculateListingCostWithoutFees(row0, retrieveExchangeRate);
  const protocolCurrencyCode = row.protocolCurrencyCode || row.userCurrencyCode;
  const userToProtocolCurrency = await retrieveExchangeRate(row.userCurrencyCode, protocolCurrencyCode);
  const vendorToListingCurrency = await retrieveExchangeRate(row.vendorCurrencyCode, row.listingCurrencyCode);
  const vendorToProtocolCurrency = await retrieveExchangeRate(row.vendorCurrencyCode, protocolCurrencyCode);

  // Amazon - shown on listing page in vendor's currency
  const taxPercent = row.taxPercent || 0;
  const salesTax = (
    row.vendorCountryId === 2 &&
    row.userCountryId === 2 &&
    row.listingCurrencyCode === "USD" &&
    row.salesTax) ? row.salesTax : 0;

  const baseTax = row.baseTax ? row.baseTax * userToProtocolCurrency : 0;

  // Delivery price shown in vendor's currency, base tax shown in user's currency
  // Fees per month calculated in user's currency
  const feesPerOrder = (row.deliveryPrice || 0) * vendorToProtocolCurrency + baseTax;
  const maxListingsPerOrder = Math.floor(row.basketLimit * vendorToListingCurrency / row.price);
  const orderFeesPerListing = feesPerOrder / maxListingsPerOrder;

  // Calculate listing price with per-listing taxes & exchange rate
  // Per-product delivery costs are also taxed
  // Base tax shown in user's currency
  const priceWithFees = (
    (row.priceWithoutFees + (row.deliveryPerListing || 0) * row.exchangeRate) *
    (1 + taxPercent / 100) *
    (1 + salesTax / 100)) + (includeOrderFees ? orderFeesPerListing : 0);

  return { ...row, priceWithFees, maxListingsPerOrder, orderFeesPerListing };
}



/////// Total Costs ///////////////


export async function calculateTotalCostsPerMonth(rows: {
  costPerMonthWithFees?: number,
  costPerMonthWithoutFees?: number }[])
{
  const costPerMonthWithFees = rows.reduce((cost, row) => cost += row.costPerMonthWithFees || 0, 0);
  const costPerMonthWithoutFees = rows.reduce((cost, row) => cost += row.costPerMonthWithoutFees || 0, 0);

  return { costPerMonthWithFees, costPerMonthWithoutFees };
}
