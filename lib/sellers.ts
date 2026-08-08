/**
 * Two seller agents with deliberately different accuracy profiles.
 * The CONTRAST is the demo: one earns, one settles at $0 and its on-chain
 * reputation degrades. Nobody arbitrates that.
 */
export interface Seller {
  id: string;
  name: string;
  blurb: string;
  wallet: `0x${string}`;
  maxPrice: string;
  /** Probability the emitted direction is the true one. */
  skill: number;
  erc8004TokenId?: string;
}

export const SELLERS: Record<string, Seller> = {
  "seller-a": {
    id: "seller-a",
    name: "Meridian Alpha",
    blurb: "Short-horizon momentum on majors. Sells capacity it can't deploy.",
    wallet: (process.env.SELLER_A_ADDR ?? "0x0") as `0x${string}`,
    maxPrice: "$0.50",
    skill: 0.85,
  },
  "seller-b": {
    id: "seller-b",
    name: "Kestrel Signals",
    blurb: "Claims a proprietary orderflow edge. Track record says otherwise.",
    wallet: (process.env.SELLER_B_ADDR ?? "0x0") as `0x${string}`,
    maxPrice: "$0.50",
    skill: 0.2,
  },
};

export const getSeller = (id: string): Seller | undefined => SELLERS[id];
