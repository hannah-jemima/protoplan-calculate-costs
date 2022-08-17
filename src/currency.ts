/* eslint-disable @typescript-eslint/ban-ts-comment */

import { exchangeRates } from "exchange-rates-api";

export async function retrieveExchangeRate(fromCurrencyCode: string, toCurrencyCode: string)
{
  if(fromCurrencyCode === toCurrencyCode)
    return 1;

  try
  {
    return exchangeRates()
      // @ts-ignore
      .setApiBaseUrl('https://api.exchangerate.host')
      .latest()
      .base(fromCurrencyCode)
      .fetch()
      .then((rates: any) => rates[toCurrencyCode]) as Promise<number>;
  }
  catch(err)
  {
    console.log(err);
    return 1;
  }
}
