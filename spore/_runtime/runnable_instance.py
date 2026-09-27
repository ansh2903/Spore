import sys
import subprocess
from spore._config.settings import Settings

class runtime_instance():
    def __init__(self) -> None:
        self.platform = sys.platform
        self.is_containerized = self._detect_container()

    def _detect_container(self) -> bool:
        if self.platform != 'linux':
            return False
        
        return self._linux_container_check()

    def _linux_container_check(self) -> bool:
        container_flag = Settings.DETECT_CONTAINER
        try:
            result = subprocess.run(
                ["sh", "-c", "test -f /.dockerenv"],
                capture_output=True,
                text=True,
                check=False, 
                timeout=2
                )
            
            if container_flag == True and result.returncode == 0:
                return True
        except (subprocess.SubprocessError, OSError):
            return False
        