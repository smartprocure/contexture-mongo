import mongoId from '../../src/example-types/mongoId.js'
import mongodb from 'mongodb'

let { ObjectID } = mongodb

describe('mongoId', () => {
  describe('mongoId.hasValue', () => {
    it('should check for value', () => {
      expect(
        !!mongoId.hasValue({
          type: 'mongoId',
          field: 'test',
          value: '53b46feb938d89315aae1477',
        })
      ).toBe(true)
      expect(
        !!mongoId.hasValue({
          type: 'mongoId',
          field: 'test',
        })
      ).toBe(false)
    })
  })
  describe('mongoId.filter', () => {
    it('should create filter for _id', () => {
      expect(
        mongoId.filter({
          field: '_id',
          value: '53b46feb938d89315aae1477',
        })
      ).toEqual({
        _id: {
          $in: [new ObjectID('53b46feb938d89315aae1477')],
        },
      })
    })
    it('should handle $in with a data.values array', () => {
      expect(
        mongoId.filter({
          field: '_id',
          values: ['53b46feb938d89315aae1477'],
        })
      ).toEqual({
        _id: {
          $in: [new ObjectID('53b46feb938d89315aae1477')],
        },
      })
    })
    it('should handle $in with a data.values array', () => {
      expect(
        mongoId.filter({
          field: '_id',
          mode: 'exclude',
          values: ['53b46feb938d89315aae1477'],
        })
      ).toEqual({
        _id: {
          $nin: [new ObjectID('53b46feb938d89315aae1477')],
        },
      })
    })
  })
})
