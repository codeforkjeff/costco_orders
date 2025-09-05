from decimal import Decimal
import json
import sqlite3
from typing import Dict, List


def calculate_adjusted_amount(item: Dict, items: List[Dict]):
    needle = f"/{item['itemNumber']}"
    discount = [i for i in items if i["itemDescription01"] == needle]
    if len(discount) > 0:
        assert len(discount) == 1
        assert discount[0]["amount"] < 0
        return float(Decimal(item["amount"]) + Decimal(discount[0]["amount"]))
    return item["amount"]


def load_json_into_db(inputfile: str, outputfile: str):
    with open(inputfile) as f:
        data = json.load(f)

    receipts = []

    for barcode, response in data.items():
        receipts_list = response["data"]["receiptsWithCounts"]["receipts"]
        # assert len(receipts_list) == 1
        if len(receipts_list) > 1:
            print(receipts_list)
            raise Exception(f"ugh, barcode={barcode}")
        receipts.append(receipts_list[0])

    # determine fields
    receipt_fields = set()
    item_fields = set(
        ["transactionBarcode", "adjustedAmount", "adjustedItemUnitPriceAmount"]
    )
    tender_fields = set(["transactionBarcode"])
    subtaxes_fields = set(["transactionBarcode"])

    for receipt in receipts:
        receipt_fields.update(
            set(receipt.keys()) - set(["itemArray", "tenderArray", "subTaxes"])
        )
        item_records = receipt["itemArray"]
        for item in item_records:
            item_fields.update(set(item.keys()))

        tender_records = receipt["tenderArray"]
        for tender in tender_records:
            tender_fields.update(set(tender.keys()))

        subtaxes = receipt["subTaxes"]
        if subtaxes:
            subtaxes_fields.update(set(subtaxes.keys()))

    # turn sets into lists: order matters in insertions
    receipt_fields = list(receipt_fields)
    item_fields = list(item_fields)
    tender_fields = list(tender_fields)
    subtaxes_fields = list(subtaxes_fields)

    db = sqlite3.connect(outputfile)
    cursor = db.cursor()

    cursor.execute(f"CREATE TABLE receipt ({','.join(receipt_fields)})")
    cursor.execute(f"CREATE TABLE item ({','.join(item_fields)})")
    cursor.execute(f"CREATE TABLE tender ({','.join(tender_fields)})")
    cursor.execute(f"CREATE TABLE subtax ({','.join(subtaxes_fields)})")

    receipts_to_insert = []
    items_to_insert = []
    tender_to_insert = []
    subtaxes_to_insert = []

    for receipt in receipts:
        receipts_to_insert.append([receipt.get(f) for f in receipt_fields])
        barcode = receipt["transactionBarcode"]
        for item in receipt["itemArray"]:
            item["transactionBarcode"] = barcode
            item["adjustedAmount"] = calculate_adjusted_amount(
                item, receipt["itemArray"]
            )
            item["adjustedItemUnitPriceAmount"] = float(
                Decimal(item["adjustedAmount"]) / Decimal(item["unit"])
            )
            items_to_insert.append([item.get(f) for f in item_fields])
        for tender in receipt["tenderArray"]:
            tender["transactionBarcode"] = barcode
            tender_to_insert.append([tender.get(f) for f in tender_fields])
        if receipt["subTaxes"]:
            subtaxes = receipt["subTaxes"]
            subtaxes["transactionBarcode"] = barcode
            subtaxes_to_insert.append([subtaxes.get(f) for f in subtaxes_fields])

    sql = f"INSERT INTO receipt ({','.join(receipt_fields)}) VALUES ({','.join(['?' for _ in receipt_fields])})"
    cursor.executemany(sql, receipts_to_insert)

    sql = f"INSERT INTO item ({','.join(item_fields)}) VALUES ({','.join(['?' for _ in item_fields])})"
    cursor.executemany(sql, items_to_insert)

    sql = f"INSERT INTO tender ({','.join(tender_fields)}) VALUES ({','.join(['?' for _ in tender_fields])})"
    cursor.executemany(sql, tender_to_insert)

    sql = f"INSERT INTO subtax ({','.join(subtaxes_fields)}) VALUES ({','.join(['?' for _ in subtaxes_fields])})"
    cursor.executemany(sql, subtaxes_to_insert)

    db.commit()

    db.close()


if __name__ == "__main__":
    load_json_into_db("costco_orders_data.json", "costco_orders.db")
