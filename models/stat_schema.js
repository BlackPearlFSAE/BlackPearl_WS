
import { DataTypes } from 'sequelize';
export let Stat;

export const initStatModel = (sequelize) => {
  Stat = sequelize.define('Stat', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    data: { type: DataTypes.JSONB }
  }, { tableName: 'stats', timestamps: true });
  return Stat;
};
