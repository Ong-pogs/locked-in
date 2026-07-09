//! Pot window-id derivation: a Unix timestamp -> UTC `YYYYMM`.
//!
//! Audit MED-5: `window_id` was a caller argument, so a permissionless
//! `force_return` could scatter forfeited USDC into windows the monthly cron
//! never distributes. The program must derive the id from `Clock` instead.
//!
//! There is no `chrono` in the BPF target, so this uses Howard Hinnant's
//! civil-from-days algorithm (public domain). It is exact for all dates the
//! program will ever see and is unit-tested against known instants.

use anchor_lang::prelude::*;

const SECONDS_PER_DAY: i64 = 86_400;

/// UTC calendar id `year * 100 + month` for a Unix timestamp (seconds).
/// e.g. 2026-07 -> 202607. Monotonic across months, so `<` compares chronology.
pub fn window_id_from_unix(ts: i64) -> Result<i64> {
    require!(ts >= 0, WindowError::TimestampBeforeEpoch);
    let (year, month, _day) = civil_from_days(ts.div_euclid(SECONDS_PER_DAY));
    Ok((year as i64) * 100 + (month as i64))
}

/// Days since 1970-01-01 -> (year, month [1..12], day [1..31]).
/// Howard Hinnant, "chrono-Compatible Low-Level Date Algorithms".
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468; // shift epoch to 0000-03-01
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[error_code]
pub enum WindowError {
    #[msg("Timestamp precedes the Unix epoch.")]
    TimestampBeforeEpoch,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_instants() {
        // 2026-07-09T00:00:00Z = 1783555200
        assert_eq!(window_id_from_unix(1_783_555_200).unwrap(), 202607);
        // 1970-01-01T00:00:00Z
        assert_eq!(window_id_from_unix(0).unwrap(), 197001);
        // 2000-03-01T00:00:00Z = 951868800
        assert_eq!(window_id_from_unix(951_868_800).unwrap(), 200003);
        // 2024-02-29T12:00:00Z (leap day) = 1709208000
        assert_eq!(window_id_from_unix(1_709_208_000).unwrap(), 202402);
        // 2023-12-31T23:59:59Z = 1704067199 -> still December
        assert_eq!(window_id_from_unix(1_704_067_199).unwrap(), 202312);
        // 2024-01-01T00:00:00Z = 1704067200 -> January, year rolled
        assert_eq!(window_id_from_unix(1_704_067_200).unwrap(), 202401);
    }

    #[test]
    fn window_ids_are_monotonic_across_months() {
        let jan = window_id_from_unix(1_704_067_200).unwrap(); // 2024-01
        let feb = window_id_from_unix(1_706_745_600).unwrap(); // 2024-02
        let dec = window_id_from_unix(1_733_011_200).unwrap(); // 2024-12
        let next_jan = window_id_from_unix(1_735_689_600).unwrap(); // 2025-01
        assert!(jan < feb);
        assert!(feb < dec);
        assert!(dec < next_jan, "year boundary must still increase");
    }

    #[test]
    fn month_boundary_is_exact_to_the_second() {
        // 2025-06-30T23:59:59Z = 1751327999 -> June
        assert_eq!(window_id_from_unix(1_751_327_999).unwrap(), 202506);
        // 2025-07-01T00:00:00Z = 1751328000 -> July
        assert_eq!(window_id_from_unix(1_751_328_000).unwrap(), 202507);
    }

    #[test]
    fn rejects_pre_epoch() {
        assert!(window_id_from_unix(-1).is_err());
    }

    #[test]
    fn civil_from_days_matches_epoch() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(-1), (1969, 12, 31));
        assert_eq!(civil_from_days(59), (1970, 3, 1)); // 1970 not a leap year
    }
}
