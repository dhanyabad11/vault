import { migrate } from '../src/database/migrate';

// Runs once before the whole Jest run: make sure the schema exists.
export default async function globalSetup(): Promise<void> {
  await migrate();
}
