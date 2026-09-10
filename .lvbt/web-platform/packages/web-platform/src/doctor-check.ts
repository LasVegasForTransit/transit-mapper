export interface DoctorCheck {
  id: string;
  status: 'pass' | 'fail' | 'unknown';
  requirement: string;
}

export async function doctorCheck(
  id: string,
  requirement: string,
  inspect: () => Promise<boolean>,
): Promise<DoctorCheck> {
  try {
    return { id, requirement, status: (await inspect()) ? 'pass' : 'fail' };
  } catch {
    return { id, requirement, status: 'unknown' };
  }
}
