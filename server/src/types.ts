export type SourceId = 'iredo' | 'dpmhk' | 'nextbike';

export type VehicleKind = 'train' | 'bus' | 'mhd';

/** Jednotný formát živého vozidla bez ohledu na zdroj. */
export interface Vehicle {
  /** Unikátní klíč spoje v rámci dne (pro historii a párování). */
  tripKey: string;
  source: Exclude<SourceId, 'nextbike'>;
  kind: VehicleKind;
  /** Číslo linky, jak ho zná cestující (např. „V4“, „383“, „27“). */
  line: string;
  /** Popisek spoje (např. „Os 6242“, „650628 8“). */
  name: string;
  from?: string;
  to?: string;
  /** Plánovaný odjezd z výchozí / příjezd do cílové zastávky (HH:MM). */
  depTime?: string;
  arrTime?: string;
  lat: number;
  lon: number;
  bearing?: number;
  /** Zpoždění v sekundách, null = neznámé. */
  delaySec: number | null;
  operator?: string;
  vehicleNo?: string;
  /** Kdy vozidlo naposledy poslalo polohu (epoch ms). */
  updatedAt: number;
}

export interface BikePlace {
  id: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
  /** true = stanice, false = volně odložené kolo. */
  isStation: boolean;
  bikes: number;
  freeRacks: number | null;
  bikeNumbers: string[];
}

export interface Stop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  kind: VehicleKind;
}

export interface TripStop {
  id?: string;
  name: string;
  lat: number | null;
  lon: number | null;
  /** Plánovaný odjezd (u konečné příjezd), HH:MM. */
  plannedTime?: string;
  /** Skutečný odjezd/příjezd, pokud ho zdroj zná, HH:MM. */
  realTime?: string;
  passed: boolean;
}

export interface TripDetail {
  tripKey: string;
  /** Přesný tvar trasy jako [lat, lon]. */
  shape: [number, number][];
  stops: TripStop[];
}

export interface SourceStatus {
  ok: boolean;
  lastSuccess: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  itemCount: number;
}

/** Jeden odjezd ze zastávky. */
export interface Departure {
  /** Klíč spoje – pokud je vozidlo na mapě, dá se podle něj vybrat. */
  tripKey: string;
  kind: VehicleKind;
  line: string;
  to?: string;
  /** Plánovaný odjezd, HH:MM (pražský čas). */
  plannedTime: string;
  /** Očekávaný odjezd (plán + zpoždění) jako epoch ms – podle něj se řadí. */
  expectedAt: number;
  delaySec: number | null;
  platform?: string;
  /** true = spoj právě jede a je na mapě. */
  live: boolean;
}

export interface StopDepartures {
  stopId: string;
  departures: Departure[];
}
