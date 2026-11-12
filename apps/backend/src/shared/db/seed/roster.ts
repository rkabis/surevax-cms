/**
 * Seed section: the clinic's real nursing roster.
 *
 * Imported from the `Nurse` sheet of the live AppSheet export
 * (`surevax_gsheet_db.xlsx`): 103 people and the branches each is assigned to,
 * which in the legacy app is a comma-separated `n_BranchRef` list. Two source
 * quirks were resolved on the way in and are worth knowing before re-importing:
 *
 *  - One row lists `Rosario` among the branches (Lorraine Rosario's own
 *    surname, pasted into the branch column). There is no Rosario branch in the
 *    `Branch` sheet, so the token is dropped.
 *  - Twenty people carry no branch at all. They are seeded `isActive: false`
 *    with no `user_branches` row: former staff, not staff assigned everywhere.
 *    Only active, branch-assigned clinicians appear in the administer
 *    attestation picker, which is the behaviour we want.
 *
 * Every one of them is a `Nurse` with `canLogin: false`: the clinic works from
 * one shared day-scoped `Branch` session, and a nurse identifies herself with a
 * 4-digit kiosk PIN: to clock in, and (since the attestation change) to put her
 * name on a dose. Giving each nurse a password login is a separate decision, not
 * a seeding one.
 *
 * PRC licence numbers are NOT in the export. Real ones have to come from the
 * clinic's HR records; `licenseNumber` is left null rather than invented, since
 * a fabricated licence number on an immunization record is worse than none.
 */

export interface RosterMember {
  firstName: string
  lastName: string
  /** Branch codes from the `Branch` sheet's `b_TransactionInitials`. */
  branches: string[]
}

/** Sorted by surname so the seeded `USR_…` display ids stay stable across runs. */
export const NURSE_ROSTER: RosterMember[] = [
  {
    firstName: 'Ysabel Francesca',
    lastName: 'Abad',
    branches: ['HST', 'TMG', 'SJN', 'SAL', 'MRK', 'PSG', 'MYS', 'STM'],
  },
  { firstName: 'Maleth', lastName: 'Adarayan', branches: ['HST', 'TMG'] },
  {
    firstName: 'Monika',
    lastName: 'Afable',
    branches: ['SJN', 'TMG', 'HST', 'TAG', 'MRK', 'SAL', 'PSG'],
  },
  { firstName: 'Jessica May', lastName: 'Agliam', branches: [] },
  { firstName: 'Angelica Jones', lastName: 'Alameda', branches: ['HST', 'TMG', 'VRT', 'TAG'] },
  { firstName: 'Mary Stephanie', lastName: 'Anelle', branches: ['HST', 'TMG'] },
  { firstName: 'Carol', lastName: 'Angeles', branches: ['MYS'] },
  { firstName: 'Peter Eran Carl Philip', lastName: 'Aquino', branches: ['MYS', 'TMG'] },
  { firstName: 'Dipsey Faith', lastName: 'Aragon', branches: ['TMG', 'HST', 'SAL'] },
  { firstName: 'Raiza', lastName: 'Bacarrisas', branches: ['ABF', 'VRT'] },
  { firstName: 'Sheena', lastName: 'Balanay', branches: [] },
  { firstName: 'Segrid', lastName: 'Barredo', branches: [] },
  { firstName: 'Julianne', lastName: 'Basco', branches: ['HST', 'TMG', 'MRK'] },
  { firstName: 'Andrea Nicole', lastName: 'Batalla', branches: ['NOV'] },
  { firstName: 'Ariane Joy', lastName: 'Battung', branches: ['HST', 'TMG', 'MRK'] },
  { firstName: 'Ronald Christopher', lastName: 'Bautista', branches: ['MRK'] },
  { firstName: 'Liezel', lastName: 'Beltran', branches: [] },
  {
    firstName: 'James Rovic',
    lastName: 'Buhay',
    branches: ['SJN', 'TMG', 'NOV', 'MYS', 'MRK', 'PSG', 'HST', 'ALB'],
  },
  { firstName: 'Jhoana', lastName: 'Bunda', branches: [] },
  { firstName: 'Bobby', lastName: 'Cabanjen', branches: [] },
  { firstName: 'Leonora', lastName: 'Caluag', branches: ['HST', 'TMG'] },
  { firstName: 'Danna', lastName: 'Cantil', branches: ['TMG', 'MYS'] },
  { firstName: 'Jolina', lastName: 'Cariaga', branches: [] },
  { firstName: 'Kristine', lastName: 'Carillo', branches: ['MYS', 'TMG', 'ALB', 'ABF'] },
  { firstName: 'Eimerry', lastName: 'Carlos', branches: ['MYS'] },
  { firstName: 'Jillian', lastName: 'Carlos', branches: ['SAL', 'TMG', 'VRT'] },
  {
    firstName: 'Kristine Kate',
    lastName: 'Cartoneros',
    branches: ['TMG', 'SJN', 'MYS', 'MRK', 'NOV'],
  },
  {
    firstName: 'Riecynn',
    lastName: 'Casiano',
    branches: ['SJN', 'TMG', 'NOV', 'ALB', 'MYS', 'PSG'],
  },
  { firstName: 'Angela', lastName: 'Castillo', branches: ['TMG', 'MYS'] },
  { firstName: 'Aliana Mei', lastName: 'Cortez', branches: ['HST', 'TMG', 'NOV', 'ALB'] },
  { firstName: 'Ruth', lastName: 'Cuadrante', branches: ['SJN', 'TMG'] },
  {
    firstName: 'Encee Nicholaus',
    lastName: 'De Asa',
    branches: ['SJN', 'TMG', 'HST', 'MRK', 'MYS'],
  },
  { firstName: 'Elijah', lastName: 'Dipay', branches: ['SJN'] },
  { firstName: 'Jessica', lastName: 'Dominguez', branches: [] },
  { firstName: 'Yana', lastName: 'Dumapi', branches: [] },
  { firstName: 'Michelin', lastName: 'Dumlao', branches: ['MYS', 'TMG'] },
  { firstName: 'Jammil', lastName: 'Dumpa', branches: [] },
  {
    firstName: 'Joselle',
    lastName: 'Faustino',
    branches: ['TMG', 'CNT', 'MYS', 'SAL', 'ABF', 'TAG', 'ALB', 'PSG', 'MRK'],
  },
  { firstName: 'Wenchester', lastName: 'Gabutero', branches: [] },
  { firstName: 'Gemmalyn', lastName: 'Galicha', branches: ['HST', 'SAL', 'VRT'] },
  { firstName: 'Gallenero', lastName: 'Gallenero', branches: ['TMG', 'CNT'] },
  { firstName: 'Aaron', lastName: 'Garcia', branches: ['TMG', 'SAL', 'MYS', 'CNT', 'TAG', 'ABF'] },
  { firstName: 'Nicole', lastName: 'Garcia', branches: ['TAG', 'SAL', 'VRT', 'TMG', 'ABF'] },
  { firstName: 'Samantha Claire', lastName: 'Garcia', branches: ['TMG', 'MYS', 'ABF', 'SJN'] },
  { firstName: 'Kristine', lastName: 'Garil', branches: [] },
  { firstName: 'Fatima', lastName: 'Hines', branches: [] },
  { firstName: 'Cari', lastName: 'Inalugan', branches: [] },
  { firstName: 'Mitzi', lastName: 'Isobal', branches: ['MYS'] },
  { firstName: 'Marienhel Apple', lastName: 'Laguerta', branches: ['HST', 'TMG'] },
  { firstName: 'Kryzelle Jane', lastName: 'Langit', branches: ['SJN', 'TMG'] },
  { firstName: 'Shara Pearl', lastName: 'Ledesma', branches: ['TMG', 'MYS', 'CNT'] },
  { firstName: 'Hazel Victoria', lastName: 'Lintag', branches: ['TMG', 'SAL', 'HST', 'MRK'] },
  { firstName: 'Gail', lastName: 'Lipata', branches: ['SJN', 'TMG'] },
  { firstName: 'Francine Raye', lastName: 'Lorenzo', branches: ['SJN'] },
  { firstName: 'Rowiechell', lastName: 'Lumagbas', branches: ['SJN', 'TMG', 'MRK'] },
  { firstName: 'Frank Lloyd', lastName: 'Manalang', branches: ['SJN', 'TMG', 'ALB'] },
  { firstName: 'Janelle', lastName: 'Mandigma', branches: ['HST', 'TMG', 'CNT', 'SAL'] },
  { firstName: 'Kyla Joy', lastName: 'Manimtim', branches: ['SJN', 'TMG', 'PSG', 'SAL', 'TAG'] },
  { firstName: 'Chelsea', lastName: 'Marano', branches: ['ABF'] },
  { firstName: 'James Brian', lastName: 'Mariano', branches: ['TMG', 'ALB'] },
  { firstName: 'Mark Christian', lastName: 'Mark Christian', branches: ['MYS'] },
  { firstName: 'Robee Xan Daniel Marquez', lastName: 'Marquez', branches: ['MYS', 'TMG'] },
  { firstName: 'Hamza', lastName: 'Masbud', branches: ['MYS'] },
  { firstName: 'Mat Aiehliah', lastName: 'Mateo', branches: ['HST', 'TMG', 'SAL', 'SJN', 'STM'] },
  { firstName: 'Crystal', lastName: 'Medina', branches: ['TMG', 'SAL', 'VRT'] },
  { firstName: 'Erica Mae', lastName: 'Miranda', branches: ['SJN', 'TMG'] },
  { firstName: 'Mary Julienne', lastName: 'Nicdao', branches: ['HST', 'VRT', 'TMG'] },
  { firstName: 'Fresly', lastName: 'Ong', branches: [] },
  { firstName: 'Gabbie', lastName: 'Pacheco', branches: [] },
  { firstName: 'Jazel', lastName: 'Par', branches: ['SJN', 'TMG'] },
  {
    firstName: 'Miecah',
    lastName: 'Patiño',
    branches: ['SAL', 'VRT', 'MYS', 'TMG', 'TAG', 'CNT', 'SJN', 'ALB', 'ABF'],
  },
  { firstName: 'Christine', lastName: 'Ponpon', branches: ['HST', 'TMG'] },
  {
    firstName: 'Roberose',
    lastName: 'Puri',
    branches: ['HST', 'VRT', 'TMG', 'SAL', 'CNT', 'NOV', 'MRK'],
  },
  { firstName: 'Mark', lastName: 'Quilo', branches: ['TMG', 'SJN'] },
  { firstName: 'Maria', lastName: 'Racca', branches: [] },
  { firstName: 'Maegan Marie', lastName: 'Reyes', branches: ['HST', 'TMG', 'ABF', 'ALB'] },
  { firstName: 'Alexandra', lastName: 'Ricardo', branches: ['ABF', 'TMG'] },
  { firstName: 'Eyra', lastName: 'Rimando', branches: ['TMG'] },
  {
    firstName: 'Lorraine',
    lastName: 'Rosario',
    branches: ['HST', 'TMG', 'ABF', 'SAL', 'VRT', 'MYS', 'CNT', 'SJN', 'MRK', 'NOV'],
  },
  { firstName: 'Czarina', lastName: 'Saez', branches: ['TAG', 'SAL'] },
  { firstName: 'Al Joshua', lastName: 'Sakandal', branches: ['HST', 'TMG', 'TAG', 'ABF', 'MYS'] },
  { firstName: 'Mildred', lastName: 'Sakandal', branches: ['SAL', 'VRT', 'TMG'] },
  { firstName: 'Miguel', lastName: 'Salcedo', branches: ['TMG', 'HST'] },
  { firstName: 'Ashley Phoebe', lastName: 'Santos', branches: ['MYS', 'TMG', 'ABF'] },
  { firstName: 'Malachi', lastName: 'Saquido', branches: ['HST', 'TMG', 'ABF', 'CNT'] },
  { firstName: 'Jiza', lastName: 'Saraspe', branches: ['HST', 'TMG', 'SAL', 'MYS'] },
  { firstName: 'Vanessa Remelyn', lastName: 'Servidad', branches: ['SJN', 'TMG'] },
  { firstName: 'Andrea Nicole', lastName: 'Soriano', branches: ['HST', 'TMG', 'CNT'] },
  {
    firstName: 'Christine Mae',
    lastName: 'Soriano Pagallaman',
    branches: ['SJN', 'TMG', 'TAG', 'MYS'],
  },
  { firstName: 'Nur Ajima', lastName: 'Susulan', branches: ['MYS', 'TMG'] },
  { firstName: 'Angelene', lastName: 'Tagle', branches: ['HST', 'TMG', 'TAG', 'SAL'] },
  { firstName: 'Rachelle', lastName: 'Tan', branches: ['ABF', 'VRT'] },
  { firstName: 'Therese', lastName: 'Tanael', branches: ['HST', 'TMG'] },
  { firstName: 'Jose', lastName: 'Tanchiangco', branches: [] },
  { firstName: 'Jan Paula', lastName: 'Tarasina', branches: ['HST', 'TMG', 'NOV', 'SJN'] },
  { firstName: "O'meara Miguel", lastName: 'Tecson', branches: ['TMG', 'HST'] },
  { firstName: 'Kinneth Al', lastName: 'Tuba-on', branches: ['MYS', 'TMG', 'NOV'] },
  { firstName: 'Ella Dian', lastName: 'Tubigon', branches: [] },
  { firstName: 'Jacqueline', lastName: 'Tungol', branches: ['ABF', 'VRT'] },
  { firstName: 'Danica Hernaiz', lastName: 'Uy', branches: ['SJN', 'TMG', 'PSG', 'NOV', 'HST'] },
  { firstName: 'Riana', lastName: 'Uy', branches: ['TMG', 'HST'] },
  { firstName: 'Abegail Joy', lastName: 'Victorino', branches: ['TMG', 'ABF'] },
  { firstName: 'Nurhaira', lastName: 'Yacob', branches: [] },
]
