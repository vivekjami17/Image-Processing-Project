import knexFactory, { type Knex } from 'knex';

export function createDb(connectionString: string, poolMax = 10): Knex {
  return knexFactory({
    client: 'pg',
    connection: connectionString,
    pool: { min: 0, max: poolMax },
  });
}
