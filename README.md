
# Scraper for Costco order data

This repository contains:
- a Tampermonkey script that downloads all your warehouse orders into a JSON file
- a Python script to load the JSON file into tables in a SQLite database

## How to use this

Install:
- Clone this repository
- Install [Tampermonkey](https://www.tampermonkey.net) in your browser
- Click on Extensions in the toolbar, select Tampermonkey, click Dashboard icon
- Click on the Utilities tab, look for "Import from File" section, and click the "Browse..." button
- Select the `costco_orders.js` file

Use the Costco website:
- Login to the Costco website
- Click the "Orders & Returns" link at the top right corner of any Costco page
- There should be a "Download all warehouse orders" button in the top right corner
  of the orders page. Click it.
- Be patient. When the process is finished, you'll see a popup that says "all done!"

Run the script to create the SQLite database:
- `python3 create_costco_orders_db.py`

Use a SQLite client to run queries on the data. For example, here is a query
showing repeated purchases and min/max amount paid for them:

```sql
with agg as (
  select
    itemNumber,
    count(*) as total,
    min(adjustedAmount) as minAmount,
    max(adjustedAmount) as maxAmount
  from item
  group by itemNumber
)
,items_with_rownum as (
  -- select an arbitrary set of description fields for itemNumber;
  -- they do change, which is why this is here
  select
    itemNumber,
    itemDescription01,
    itemDescription02,
    row_number() over (partition by itemNumber order by itemDescription01, itemDescription02) as rownum
  from item
)
,deduped as (
  select
    itemNumber,
    itemDescription01,
    itemDescription02
  from items_with_rownum
  where rownum = 1
)
select
    agg.total,
    agg.itemNumber,
    deduped.itemDescription01,
    deduped.itemDescription02,
    agg.minAmount,
    agg.maxAmount,
  round((agg.maxAmount - agg.minAmount) / agg.minAmount * 100, 2) as percentDiff
from agg
left join deduped on agg.itemNumber = deduped.itemNumber
where agg.total > 1
order by agg.total desc
```

## Database Tables

receipt
- represents a receipt
- the PK is `transactionBarcode`

item
- represents an item on the receipt
- `transactionBarcode` is the FK into the receipt to which the item belongs
- note that discounts are represented as items and have negative values
  in the `amount` field
- the `adjustedAmount` field subtracts the discount from the `amount` field

subtax
- represents various types of taxes calculated on the items on the receipt
- `transactionBarcode` is the FK into the receipt to which the subtax record belongs

tender
- payment(s) made on the receipt
- `transactionBarcode` is the FK into the receipt to which the tender record belongs
