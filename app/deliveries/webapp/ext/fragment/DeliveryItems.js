// app/deliveries/webapp/ext/fragment/DeliveryItems.js
sap.ui.define([
    "sap/ui/model/json/JSONModel"
], function (JSONModel) {
    "use strict";

    const handler = {

        onLoadItems: function (oEvent) {
            const oSource = oEvent.getSource();
            const oCtx    = oSource.getBindingContext();
            if (!oCtx) return;

            const deliveryDoc = oCtx.getObject().DeliveryDocument;
            if (!deliveryDoc) return;

            handler._fetchItems(oCtx.getModel(), deliveryDoc);
        },

        _fetchItems: function (oModel, deliveryDoc) {
            const oBtn   = handler._find("btnLoadItems");
            const oTable = handler._find("deliveryItemsTable");

            if (oBtn)   oBtn.setEnabled(false);
            if (oTable) oTable.setBusy(true);
            handler._hideError();

            const oBinding = oModel.bindContext("/getDeliveryItems(...)");
            oBinding.setParameter("deliveryDoc", deliveryDoc);

            oBinding.execute().then(() => {
                const oBoundCtx = oBinding.getBoundContext();
                if (!oBoundCtx) throw new Error("No items returned.");
                return oBoundCtx.requestObject();
            }).then(oResult => {
                // Array action returns { value: [...] }
                const items = (oResult && oResult.value) || (Array.isArray(oResult) ? oResult : []);
                const oTable = handler._find("deliveryItemsTable");
                if (oTable) {
                    // Get the static XML template item (before destroying it)
                    const oTemplate = oTable.getItems()[0] ? oTable.getItems()[0].clone() : null;
                    // Remove static item and set up proper binding
                    oTable.destroyItems();
                    oTable.setModel(new JSONModel({ items: items }), "items");
                    if (oTemplate) {
                        oTable.bindAggregation("items", {
                            path: "items>/items",
                            template: oTemplate
                        });
                    }
                    oTable.setVisible(true);
                }
            }).catch(err => {
                handler._showError(err.message || "Failed to load delivery items.");
            }).finally(() => {
                const oBtn   = handler._find("btnLoadItems");
                const oTable = handler._find("deliveryItemsTable");
                if (oBtn)   oBtn.setEnabled(true);
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
