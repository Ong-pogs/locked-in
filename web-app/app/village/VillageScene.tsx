'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, User } from 'lucide-react';
import { BuildingHotspot, type Bounds } from '@/components/village/BuildingHotspot';
import { useCourseStore } from '@/stores/courseStore';
import { T } from '@/components/theme';
import hotspotsData from '@/public/images/village/hotspots.json';

type BuildingDef = {
  id: string;
  route: string;
  label: string;
  bounds: Bounds;
};

type HotspotsFile = {
  buildings: BuildingDef[];
};

const HOTSPOTS = hotspotsData as HotspotsFile;

/**
 * 2.5D village hub — placeholder rectangles in Slice 1.
 *
 * Painterly art layers + ambient FX land in Slice 2. Mobile pan/scroll +
 * accessibility/tour come in Slice 3.
 */
export default function VillageScene() {
  const router = useRouter();

  // Lock-state guard — mirror dungeon page (lines 42-61)
  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const activeCourseIds = useCourseStore((s) => s.activeCourseIds);
  const courseStates = useCourseStore((s) => s.courseStates);
  const setActiveCourse = useCourseStore((s) => s.setActiveCourse);

  const lockedCourseIds = useMemo(
    () => activeCourseIds.filter(
      (courseId: string) => Boolean(courseStates[courseId]?.lockAccountAddress),
    ),
    [activeCourseIds, courseStates],
  );

  // Auto-select first locked course if none active
  useEffect(() => {
    if (!activeCourseId && lockedCourseIds.length > 0) {
      setActiveCourse(lockedCourseIds[0]);
    }
  }, [activeCourseId, lockedCourseIds, setActiveCourse]);

  // Guard: no locked courses → course browser
  useEffect(() => {
    if (lockedCourseIds.length === 0) {
      router.replace('/courses');
    }
  }, [lockedCourseIds.length, router]);

  return (
    <div
      className="fixed inset-0 z-0 overflow-hidden"
      style={{ backgroundColor: T.bg }}
    >
      {/* Hotspot layer — absolutely positioned rectangles */}
      <div className="absolute inset-0">
        {HOTSPOTS.buildings.map((building) => (
          <BuildingHotspot
            key={building.id}
            id={building.id}
            route={building.route}
            label={building.label}
            bounds={building.bounds}
          />
        ))}
      </div>

      {/* Floating back button — mobile only, desktop has sidebar */}
      <button
        onClick={() => router.back()}
        aria-label="Back"
        className="fixed top-4 left-4 z-30 flex items-center justify-center md:hidden"
        style={{
          width: 40,
          height: 40,
          borderRadius: 22,
          backgroundColor: 'rgba(14,14,28,0.88)',
          border: `1px solid ${T.borderAlive}`,
        }}
      >
        <ArrowLeft size={18} color={T.amber} strokeWidth={2.5} />
      </button>

      {/* Floating profile button — mobile only, desktop has sidebar */}
      <button
        onClick={() => router.push('/profile')}
        aria-label="Profile"
        className="fixed top-4 right-4 z-30 flex items-center justify-center md:hidden"
        style={{
          width: 40,
          height: 40,
          borderRadius: 22,
          backgroundColor: 'rgba(14,14,28,0.88)',
          border: `1px solid ${T.borderAlive}`,
        }}
      >
        <User size={18} color={T.amber} strokeWidth={2.5} />
      </button>
    </div>
  );
}
