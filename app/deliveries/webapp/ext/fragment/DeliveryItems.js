// app/deliveries/webapp/ext/fragment/DeliveryItems.js
sap.ui.define([
    "sap/ui/model/json/JSONModel"
], function (JSONModel) {
    "use strict";

    const handler = {

        // Called via afterRendering on the VBox in fragment XML
        onContainerRendered: function (oEvent) {
            const oSource = oEvent.getSource ? oEvent.getSource() : null;
            handler._loadWithRetry(oSource, 0);
        },

        _loadWithRetry: function (oContainer, attempt) {
            const MAX = 15;
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
                // OData V4 array action returns { value: [...] }
                const items = (oResult && oResult.value) || (Array.isArray(oResult) ? oResult : []);
                const oTbl = handler._find("deliveryItemsTable");
                if (oTbl) {
                    // Clone the static XML template item before destroying it
                    const oTemplate = oTbl.getItems()[0] ? oTbl.getItems()[0].clone() : null;
                    oTbl.destroyItems();
                    oTbl.setModel(new JSONModel({ items: items }), "items");
                    if (oTemplate) {
                        oTbl.bindAggregation("items", {
                            path: "items>/items",
                            template: oTemplate
                        });
                    }
                    oTbl.setVisible(true);
                }
            }).catch(err => {
                handler._showError(err.message || "Failed to load delivery items.");
            }).finally(() => {
                const oTbl = handler._find("deliveryItemsTable");
                if (oTbl) oTbl.setBusy(false);
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
