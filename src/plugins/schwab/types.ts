export const SCHWAB_PLUGIN_ID = "schwab";
export const SCHWAB_TRADER_BASE_URL = "https://api.schwabapi.com/trader/v1";
export const SCHWAB_OAUTH_AUTHORIZE_URL = "https://api.schwabapi.com/v1/oauth/authorize";
export const SCHWAB_OAUTH_TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";
export const SCHWAB_TOKEN_SCHEMA_VERSION = 1;

export interface SchwabTokenState {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
  updatedAt: number;
  /** Fingerprint of the Schwab app credentials used to obtain these tokens. */
  credentialKey?: string;
}

export interface SchwabAccountNumber {
  accountNumber: string;
  hashValue: string;
}

export interface SchwabInstrument {
  assetType?: string;
  symbol?: string;
  description?: string;
  cusip?: string;
  type?: string;
}

export interface SchwabPosition {
  shortQuantity?: number;
  longQuantity?: number;
  averagePrice?: number;
  marketValue?: number;
  currentDayProfitLoss?: number;
  longOpenProfitLoss?: number;
  shortOpenProfitLoss?: number;
  instrument?: SchwabInstrument;
}

export interface SchwabBalances {
  cashBalance?: number;
  liquidationValue?: number;
  buyingPower?: number;
  availableFunds?: number;
  equity?: number;
  longMarketValue?: number;
  shortMarketValue?: number;
}

export interface SchwabSecuritiesAccount {
  accountNumber?: string;
  type?: string;
  currentBalances?: SchwabBalances;
  positions?: SchwabPosition[];
}

export interface SchwabAccountPayload {
  securitiesAccount?: SchwabSecuritiesAccount;
}

export class SchwabAuthError extends Error {
  readonly code: "TOKEN_EXPIRED" | "AUTH_REQUIRED" | "INVALID_REDIRECT" | "EXCHANGE_FAILED";

  constructor(message: string, code: SchwabAuthError["code"]) {
    super(message);
    this.name = "SchwabAuthError";
    this.code = code;
  }
}
