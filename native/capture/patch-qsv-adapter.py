"""Keep OBS QSV on the selected DXGI adapter and expose its actual device LUID."""
import pathlib
import sys


def patch(directory):
    directory = pathlib.Path(directory)
    source = directory / "common_utils_windows.cpp"
    text = source.read_text()
    start = text.index("\tmfxU32 adapter_idx = ovi.adapter;")
    end = text.index("\tmfxStatus sts = MFX_ERR_NONE;", start)
    text = text[:start] + "\tif (ovi.adapter >= adapter_count || !adapters[ovi.adapter].is_intel)\n\t\treturn MFX_ERR_DEVICE_FAILED;\n" + text[end:]
    previous = "\t\tsts = MFXCreateSession(loader, adapter_idx, pSession);"
    assert text.count(previous) == 2, "Pinned QSV session anchors changed"
    replacement = '''
        // Filter the physical DXGI adapter; an Intel-only ordinal changes on hybrid systems.
        mfxConfig adapterConfig = MFXCreateConfig(loader);
        mfxVariant selected = {};
        selected.Type = MFX_VARIANT_TYPE_U32;
        selected.Data.U32 = ovi.adapter;
        sts = MFXSetConfigFilterProperty(adapterConfig, (const mfxU8 *)"DXGIAdapterIndex", selected);
        MSDK_CHECK_RESULT(sts, MFX_ERR_NONE, sts);
        sts = MFXCreateSession(loader, 0, pSession);'''
    text = text.replace(previous, replacement)
    source.write_text(text)
    source = directory / "common_directx11.cpp"
    text = source.read_text()
    start = text.index("\tmfxU32 adapterNum = 0;")
    end = text.index("\tHRESULT hres = CreateDXGIFactory1", start)
    text = text[:start] + "\tobs_video_info ovi;\n\tobs_get_video_info(&ovi);\n\tmfxU32 adapterNum = ovi.adapter;\n\t(void)session;\n\n" + text[end:]
    text += '''
// Numeric verification only; no native pointers cross the host protocol.
extern "C" __declspec(dllexport) bool cg_qsv_adapter_luid(uint64_t *luid)
{
    if (!luid || !g_pD3D11Device) return false;
    IDXGIDevice *device = nullptr;
    IDXGIAdapter *adapter = nullptr;
    DXGI_ADAPTER_DESC desc = {};
    const bool ok = SUCCEEDED(g_pD3D11Device->QueryInterface(__uuidof(IDXGIDevice), (void **)&device)) &&
        SUCCEEDED(device->GetAdapter(&adapter)) && SUCCEEDED(adapter->GetDesc(&desc));
    if (adapter) adapter->Release();
    if (device) device->Release();
    if (ok) *luid = (uint64_t(uint32_t(desc.AdapterLuid.HighPart)) << 32) | desc.AdapterLuid.LowPart;
    return ok;
}
'''
    source.write_text(text)


if __name__ == "__main__":
    patch(sys.argv[1])
