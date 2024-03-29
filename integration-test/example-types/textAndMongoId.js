import types from '../../src/types.js'
import Contexture from 'contexture'
import provider from '../../src/index.js'
import _ from 'lodash/fp.js'
import testSetup from '../setup.js'

let schemaName = 'Documents'
let collection = 'document'

let contextureTestSetup = async ({ collection }) => {
  let { db, ids } = await testSetup({ collection })
  return {
    db,
    ids,
    process: Contexture({
      schemas: {
        [schemaName]: {
          mongo: {
            collection,
          },
        },
      },
      providers: {
        mongo: provider({
          getClient: () => db,
          types: types(),
        }),
      },
    }),
  }
}

describe('Grouping text and mongoId', () => {
  it('should work', async () => {
    let {
      ids: [id],
      process,
    } = await contextureTestSetup({ collection })
    let dsl = {
      type: 'group',
      schema: schemaName,
      join: 'and',
      items: [
        {
          key: 'text',
          type: 'text',
          field: 'code',
          data: {
            operator: 'containsWord',
            value: '22',
          },
        },
        {
          key: 'specificUser',
          type: 'mongoId',
          field: '_id',
          data: {
            value: id,
          },
        },
        {
          key: 'results',
          type: 'results',
        },
      ],
    }
    let result = await process(dsl, { debug: true })
    let response = _.last(result.items).context.response
    expect(response.totalRecords).toBe(3)
    expect(response.results[0]._id.toString()).toBe(id.toString())
  })

  it('should work with populate', async () => {
    let {
      ids: [id, id2],
      process,
    } = await contextureTestSetup({ collection })
    let dsl = {
      type: 'group',
      schema: schemaName,
      join: 'and',
      items: [
        {
          key: 'text',
          type: 'text',
          field: 'code',
          data: {
            operator: 'containsWord',
            value: '22',
          },
        },
        {
          key: 'specificUser',
          type: 'mongoId',
          field: '_id',
          data: {
            value: id,
          },
        },
        {
          key: 'results',
          type: 'results',
          config: {
            populate: {
              child: {
                schema: 'Documents',
                foreignField: '_id',
                localField: 'nextCode',
              },
            },
          },
        },
      ],
    }
    let result = await process(dsl, { debug: true })
    let response = _.last(result.items).context.response
    expect(response.totalRecords).toBe(3)
    expect(response.results[0]._id.toString()).toBe(id.toString())
    expect(response.results[0].nextCode.toString()).toBe(id2.toString())
  })
})
