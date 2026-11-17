"""The Python distribution launches the embedded Rust driver; it never hosts it."""
from unittest.mock import Mock
import subprocess
import pytest
from print_at_soc import native_driver as native, virtual_printer as vp

@pytest.mark.parametrize('entry,command', [(vp.install_virtual_printer,'--install-system-printer'), (vp.uninstall_virtual_printer,'--uninstall-system-printer'), (vp.virtual_printer_status,'--native-printer-status')])
def test_public_printer_commands_delegate_to_rust(monkeypatch, entry, command):
    launch=Mock(return_value=17)
    monkeypatch.setattr(native,'launch',launch)
    assert entry(['--name','MyPrinter','--plain'])==17
    launch.assert_called_once_with(command,['--name','MyPrinter','--plain'])

def test_native_binary_receives_literal_arguments_and_exit_status(monkeypatch,tmp_path):
    executable=tmp_path/'native application'
    executable.touch()
    monkeypatch.setattr(native,'get_binary_path',lambda:executable)
    run=Mock(side_effect=[subprocess.CompletedProcess([],0,'PrintSoC Rust native driver protocol 1',''),subprocess.CompletedProcess([],130)])
    monkeypatch.setattr(native.subprocess,'run',run)
    assert native.launch('--install-system-printer',['--printer','psts-dx'])==130
    assert run.call_args.args[0]==[str(executable),'--install-system-printer','--printer','psts-dx']
    assert not run.call_args.kwargs.get('shell',False)

def test_missing_or_old_desktop_is_not_treated_as_a_working_driver(monkeypatch,tmp_path):
    executable=tmp_path/'app'
    monkeypatch.setattr(native,'get_binary_path',lambda:executable)
    run=Mock(return_value=subprocess.CompletedProcess([],0,'',''))
    monkeypatch.setattr(native.subprocess,'run',run)
    with pytest.raises(RuntimeError,match='desktop app first'): native.launch('--install-system-printer',[])
    run.assert_not_called()
    executable.touch()
    with pytest.raises(RuntimeError,match='does not include'): native.launch('--install-system-printer',[])
    assert run.call_count==1
