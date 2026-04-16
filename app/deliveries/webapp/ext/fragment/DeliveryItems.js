// app/deliveries/webapp/ext/fragment/DeliveryItems.js
sap.ui.define([
    "sap/ui/model/json/JSONModel"
], function (JSONModel) {
    "use strict";

    const handler = {

        onAfterRendering: function (oEvent) {
            const oContainer = oEvent.getSource ? oEvent.getSource() : null;
            handler._loadWithRetry(oContainer, 0);
        },

        _loadWithRetry: function (oContainer, attempt) {
            const MAX = 10;
            const oCtx = oContainer && oContainer.getBindingContext
                ? oContainer.getBindingContext()
                : null;

            if (!oCtx) {
                if (attempt < MAX) {
                    setTimeout(() => handler._loadWithRetry(oContainer, attempt + 1), 300);
                }
                return;
            }

            const deliveryDoc = oCtx.getObject().DeliveryDocument;
            if (!deliveryDoc) return;

            handler._fetchItems(oCtx.getModel(), deliveryDoc);
        },

        _fetchItems: function (oModel, deliveryDoc) {
            const oTable = handler._find("deliveryItemsTable");
            if (oTable) oTable.setBusy(true);
            handler._hideError();

            const oBinding = oModel.bindContext("/getDeliveryItems(...)");
            oBinding.setParameter("deliveryDoc", deliveryDoc);

            oBinding.execute().then(() => {
                const oBoundCtx = oBinding.getBoundContext();
                if (!oBoundCtx) throw new Error("No items returned.");
                return oBoundCtx.requestObject();
            }).then(oResult => {
                const items = Array.isArray(oResult) ? oResult : (oResult && oResult.value) || [];
                const oTable = handler._find("deliveryItemsTable");
                if (oTable) {
                    const oTemplate = oTable.getItems()[0] ? oTable.getItems()[0].clone() : null;
                    oTable.unbindAggregation("items");
                    const oItemsModel = new JSONModel({ items: items });
                    oTable.setModel(oItemsModel, "items");
                    if (oTemplate) {
                        oTable.bindAggregation("items", {
                            path: "items>/items",
                            template: oTemplate
                        });
                    }
                }
            }).catch(err => {
                handler._showError(err.message || "Failed to load delivery items.");
            }).finally(() => {
                const oTable = handler._find("deliveryItemsTable");
                if (oTable) oTable.setBusy(false);
            });
        },

        _showError: function (msg) {
            const o = handler._find("itemsErrorStrip");
            if (o) { o.setText(msg); o.setVisible(true); }
        },

        _hideError: function () {
            const o = handler._find("itemsErrorStrip");
            if (o) o.setVisible(false);
        },

        _find: function (sLocalId) {
            const el = document.querySelector(`[id$="--${sLocalId}"]`);
            if (!el) return null;
            const fullId = el.id.replace(/^sap-ui-invisible-/, "");
            return sap.ui.getCore().byId(fullId) || null;
        }
    };

    return handler;
});
